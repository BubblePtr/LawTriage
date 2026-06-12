import { WorkerOptions, cli, defineAgent, voice } from "@livekit/agents";
import { VAD } from "@livekit/agents-plugin-silero";
import { fileURLToPath } from "node:url";
import { legalReceptionSystemPrompt } from "../src/agentPrompt";
import { lawTriageAgentReplyTopic } from "../src/livekitTopics";
import { loadLocalEnvFiles, resolveAgentProviderMode } from "./agentRuntimeConfig";
import { createAgentReplyStreamPayload } from "./livekitAgentReply";
import { createVolcengineAgentModels } from "./volcengineLiveKitProviders";

type LawTriageAgentProcessData = {
  vad?: VAD;
};

const defaultModels = {
  llm: "openai/gpt-4.1-mini",
  stt: "deepgram/nova-3:zh",
  tts: "cartesia/sonic-2",
};

loadLocalEnvFiles();

export default defineAgent<LawTriageAgentProcessData>({
  prewarm: async (proc) => {
    proc.userData.vad = await VAD.load();
  },
  entry: async (ctx) => {
    const vad = ctx.proc.userData.vad ?? (await VAD.load());
    const providerMode = resolveAgentProviderMode();
    const models = providerMode === "volcengine" ? createVolcengineAgentModels(process.env) : getInferenceModels();
    const timingOptions = providerMode === "volcengine" ? getVolcengineTimingOptions() : {};
    console.info("[LawTriage LiveKit Agent] starting session", { providerMode });
    const session = new voice.AgentSession({
      ...models,
      ...timingOptions,
      vad,
    });
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
      const payload = createAgentReplyStreamPayload(event.item);

      if (!payload) {
        return;
      }

      console.info("[LawTriage LiveKit Agent] assistant text committed", {
        id: payload.id,
        textLength: payload.text.length,
      });
      void ctx.room.localParticipant
        ?.sendText(JSON.stringify(payload), {
          attributes: {
            "lawtriage.kind": "agent_reply",
            "lawtriage.reply_id": payload.id,
          },
          streamId: `lawtriage-agent-reply-${payload.id}`,
          topic: lawTriageAgentReplyTopic,
        })
        .catch((error: unknown) => {
          console.warn("[LawTriage LiveKit Agent] failed to publish agent reply stream", getErrorMessage(error));
        });
    });
    const agent = new voice.Agent({
      id: "law_triage_agent",
      instructions: legalReceptionSystemPrompt,
    });

    await session.start({
      agent,
      room: ctx.room,
      inputOptions: {
        audioEnabled: true,
        textEnabled: true,
      },
      outputOptions: {
        audioEnabled: true,
        transcriptionEnabled: true,
        syncTranscription: true,
      },
    });
    await ctx.waitForParticipant();
    await session
      .generateReply({
        instructions:
          "你已经进入法律分诊咨询房间。请先用一句自然、简短的中文开场白说明身份，并引导当事人描述离婚、财产或抚养相关问题。",
      })
      .waitForPlayout();
  },
});

function getEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();

  return value || fallback;
}

function getInferenceModels() {
  return {
    llm: getEnv("LIVEKIT_AGENT_LLM_MODEL", defaultModels.llm),
    stt: getEnv("LIVEKIT_AGENT_STT_MODEL", defaultModels.stt),
    tts: getTtsModel(),
  };
}

function getTtsModel(): string {
  const model = getEnv("LIVEKIT_AGENT_TTS_MODEL", defaultModels.tts);
  const voiceId = process.env.LIVEKIT_AGENT_TTS_VOICE?.trim();

  if (!voiceId || model.includes(":")) {
    return model;
  }

  return `${model}:${voiceId}`;
}

function getVolcengineTimingOptions() {
  return {
    forwardAudioIdleTimeout: getPositiveIntEnv("LIVEKIT_AGENT_FORWARD_AUDIO_IDLE_TIMEOUT_MS", 30_000),
    ttsReadIdleTimeout: getPositiveIntEnv("LIVEKIT_AGENT_TTS_READ_IDLE_TIMEOUT_MS", 30_000),
  };
}

function getPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new WorkerOptions({
      agent: fileURLToPath(import.meta.url),
    }),
  );
}
