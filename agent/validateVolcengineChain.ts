import { audioFramesFromFile, initializeLogger } from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { legalReceptionSystemPrompt } from "../src/agentPrompt";
import {
  createVolcArkChatCompletion,
  createVolcAsrAudioRequest,
  createVolcAsrFullClientRequest,
  createVolcAsrWebSocket,
  createVolcSpeech,
  parseVolcAsrResponse,
  type AgentApiEnv,
} from "../server/agentApi";
import { loadLocalEnvFiles } from "./agentRuntimeConfig";

const asrSampleRate = 16000;
const asrChannels = 1;
const validationTimeoutMs = 45_000;

loadLocalEnvFiles();
initializeLogger({ level: process.env.LOG_LEVEL ?? "info", pretty: true });

const sampleText = process.argv.slice(2).join(" ").trim() || "我想咨询离婚和孩子抚养问题。";
const env = process.env;

const sampleAudio = await createVolcSpeech(sampleText, env);
console.info("[volcengine validate] sample tts ok", { bytes: sampleAudio.byteLength, text: sampleText });

const transcript = await transcribeMp3WithVolcAsr(sampleAudio, env);
console.info("[volcengine validate] asr ok", { transcript });

const reply = await createVolcArkChatCompletion(
  [
    {
      content: [
        legalReceptionSystemPrompt,
        "你正在实时电话接待中，只输出下一句要播报给当事人的中文口语回复。",
        "回复要简洁自然，通常 1 到 3 句；不要输出 Markdown、JSON、编号或旁白。",
      ].join("\n"),
      role: "system",
    },
    {
      content: `当事人：${transcript}`,
      role: "user",
    },
  ],
  env,
);
console.info("[volcengine validate] ark ok", { reply });

const replyAudio = await createVolcSpeech(reply, env);
console.info("[volcengine validate] reply tts ok", { bytes: replyAudio.byteLength });

async function transcribeMp3WithVolcAsr(audio: Buffer, env: AgentApiEnv): Promise<string> {
  const path = join(tmpdir(), `lawtriage-volc-validate-${randomUUID()}.mp3`);
  await writeFile(path, audio);

  try {
    const upstream = createVolcAsrWebSocket(env);
    const utterances: string[] = [];
    const responseTask = new Promise<string>((resolve, reject) => {
      upstream.on("message", (data) => {
        try {
          const response = parseVolcAsrResponse(data);

          if (response.error) {
            reject(new Error(response.error));
            return;
          }

          for (const utterance of response.utterances) {
            const text = utterance.text.trim();

            if (text && utterance.definite) {
              utterances.push(text);
            }
          }
        } catch (error) {
          reject(error);
        }
      });
      upstream.once("close", () => resolve(utterances.join("")));
      upstream.once("error", reject);
    });

    await waitForSocketOpen(upstream);
    upstream.send(createVolcAsrFullClientRequest());

    let frameCount = 0;
    for await (const frame of audioFramesFromFile(path, {
      format: "mp3",
      numChannels: asrChannels,
      sampleRate: asrSampleRate,
    })) {
      if (frame.samplesPerChannel > 0 && upstream.readyState === WebSocket.OPEN) {
        frameCount += 1;
        upstream.send(createVolcAsrAudioRequest(audioFrameToBuffer(frame), false));
      }
    }

    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(createVolcAsrAudioRequest(Buffer.alloc(0), true));
    }

    const transcript = await withTimeout(responseTask, validationTimeoutMs);

    if (!transcript.trim()) {
      throw new Error(`火山 ASR 未返回 definite 文本。已发送音频帧数：${frameCount}`);
    }

    return transcript.trim();
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

function audioFrameToBuffer(frame: AudioFrame): Buffer {
  return Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`火山链路验证超过 ${timeoutMs / 1000} 秒。`)), timeoutMs);

    task
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timeout);
      });
  });
}
