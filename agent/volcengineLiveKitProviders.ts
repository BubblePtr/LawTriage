import {
  DEFAULT_API_CONNECT_OPTIONS,
  asLanguageCode,
  audioFramesFromFile,
  llm,
  stt,
  tts,
  type APIConnectOptions,
} from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  createVolcArkChatCompletion,
  createVolcAsrAudioRequest,
  createVolcAsrFullClientRequest,
  createVolcAsrWebSocket,
  createVolcSpeech,
  parseVolcAsrResponse,
  type AgentApiEnv,
  type ArkChatMessage,
} from "../server/agentApi";

const volcTtsSampleRate = 24000;
const volcTtsChannels = 1;
const volcAsrSampleRate = 16000;
const volcAsrLanguage = asLanguageCode("zh");
const defaultVolcAsrTurnSilenceMs = 1200;
const defaultVolcTtsChunkMaxChars = 80;
const minVolcTtsChunkMaxChars = 30;
const maxVolcTtsChunkMaxChars = 160;
const volcAsrSpeechPeakThreshold = 80;
const volcAsrSpeechAverageThreshold = 8;

export function createVolcengineAgentModels(env: AgentApiEnv = process.env) {
  return {
    llm: new VolcArkLLM(env),
    stt: new VolcSeedAsr(env),
    tts: new VolcSeedTts(env),
  };
}

class VolcArkLLM extends llm.LLM {
  constructor(private readonly env: AgentApiEnv) {
    super();
  }

  label(): string {
    return "volcengine.ark";
  }

  override get model(): string {
    return this.env.ARK_MODEL || "ark-chat-completions";
  }

  override get provider(): string {
    return "volcengine";
  }

  chat({
    chatCtx,
    toolCtx,
    connOptions,
  }: {
    chatCtx: llm.ChatContext;
    toolCtx?: llm.ToolContext;
    connOptions?: APIConnectOptions;
    parallelToolCalls?: boolean;
    toolChoice?: llm.ToolChoice;
    extraKwargs?: Record<string, unknown>;
  }): llm.LLMStream {
    return new VolcArkLLMStream(this, this.env, {
      chatCtx,
      connOptions: connOptions ?? DEFAULT_API_CONNECT_OPTIONS,
      toolCtx,
    });
  }
}

class VolcArkLLMStream extends llm.LLMStream {
  constructor(
    source: llm.LLM,
    private readonly env: AgentApiEnv,
    options: {
      chatCtx: llm.ChatContext;
      connOptions: APIConnectOptions;
      toolCtx?: llm.ToolContext;
    },
  ) {
    super(source, options);
  }

  protected async run(): Promise<void> {
    const id = randomUUID();
    const text = await createVolcArkChatCompletion(buildArkMessages(this.chatCtx), this.env, {
      maxTokens: 260,
      temperature: 0.3,
    });

    if (this.abortController.signal.aborted) {
      return;
    }

    this.queue.put({
      delta: {
        content: text,
        role: "assistant",
      },
      id,
    });
  }
}

class VolcSeedTts extends tts.TTS {
  label = "volcengine.seed-tts";

  constructor(private readonly env: AgentApiEnv) {
    super(volcTtsSampleRate, volcTtsChannels, {
      streaming: false,
    });
  }

  override get model(): string {
    return this.env.VOLC_TTS_RESOURCE_ID || "seed-tts-2.0";
  }

  override get provider(): string {
    return "volcengine";
  }

  synthesize(text: string, connOptions?: APIConnectOptions, abortSignal?: AbortSignal): tts.ChunkedStream {
    return new VolcChunkedTtsStream(text, this, this.env, connOptions ?? DEFAULT_API_CONNECT_OPTIONS, abortSignal);
  }

  stream(options?: { connOptions?: APIConnectOptions }): tts.SynthesizeStream {
    return new VolcSynthesizeStream(this, this.env, options?.connOptions ?? DEFAULT_API_CONNECT_OPTIONS);
  }
}

class VolcChunkedTtsStream extends tts.ChunkedStream {
  label = "volcengine.seed-tts.chunked";

  constructor(
    text: string,
    private readonly source: VolcSeedTts,
    private readonly env: AgentApiEnv,
    connOptions: APIConnectOptions,
    abortSignal?: AbortSignal,
  ) {
    super(text, source, connOptions, abortSignal);
  }

  protected async run(): Promise<void> {
    const requestId = randomUUID();
    const segmentId = randomUUID();

    await emitVolcSpeechChunks({
      emit: (frame, final) => {
        this.queue.put({
          final,
          frame,
          requestId,
          segmentId,
        });
      },
      env: this.env,
      numChannels: this.source.numChannels,
      sampleRate: this.source.sampleRate,
      signal: this.abortSignal,
      text: this.inputText,
    });
  }
}

class VolcSynthesizeStream extends tts.SynthesizeStream {
  label = "volcengine.seed-tts.stream";

  constructor(
    private readonly source: VolcSeedTts,
    private readonly env: AgentApiEnv,
    connOptions: APIConnectOptions,
  ) {
    super(source, connOptions);
  }

  protected async run(): Promise<void> {
    let pendingText = "";

    for await (const input of this.input) {
      if (input === VolcSynthesizeStream.FLUSH_SENTINEL) {
        await this.flushPendingText(pendingText);
        pendingText = "";
        continue;
      }

      pendingText += input;
    }

    await this.flushPendingText(pendingText);

    if (!this.abortSignal.aborted) {
      this.queue.put(tts.SynthesizeStream.END_OF_STREAM);
    }
  }

  private async flushPendingText(text: string): Promise<void> {
    const normalized = text.trim();

    if (!normalized || this.abortSignal.aborted) {
      return;
    }

    const requestId = randomUUID();
    const segmentId = randomUUID();

    await emitVolcSpeechChunks({
      emit: (frame, final, chunkText) => {
        this.queue.put({
          deltaText: chunkText,
          final,
          frame,
          requestId,
          segmentId,
        });
      },
      env: this.env,
      numChannels: this.source.numChannels,
      sampleRate: this.source.sampleRate,
      signal: this.abortSignal,
      text: normalized,
    });
  }
}

class VolcSeedAsr extends stt.STT {
  label = "volcengine.seed-asr";

  constructor(private readonly env: AgentApiEnv) {
    super({
      interimResults: false,
      streaming: true,
    });
  }

  override get model(): string {
    return this.env.VOLC_ASR_RESOURCE_ID || "volc.seedasr.sauc.duration";
  }

  override get provider(): string {
    return "volcengine";
  }

  protected async _recognize(): Promise<stt.SpeechEvent> {
    throw new Error("Volcengine ASR only supports streaming recognition in this worker.");
  }

  stream(options?: { connOptions?: APIConnectOptions }): stt.SpeechStream {
    return new VolcAsrSpeechStream(this, this.env, options?.connOptions ?? DEFAULT_API_CONNECT_OPTIONS);
  }
}

class VolcAsrSpeechStream extends stt.SpeechStream {
  label = "volcengine.seed-asr.stream";
  private readonly emittedUtterances = new Set<string>();
  private readonly finalTexts: string[] = [];
  private readonly requestId = randomUUID();
  private activeTurn?: {
    audioFrames: number;
    closed: Promise<void>;
    finalSent: boolean;
    speechFrames: number;
    trailingSilenceMs: number;
    upstream: WebSocket;
  };
  private speaking = false;
  private readonly turnSilenceMs: number;

  constructor(
    source: VolcSeedAsr,
    private readonly env: AgentApiEnv,
    connOptions: APIConnectOptions,
  ) {
    super(source, volcAsrSampleRate, connOptions);
    this.turnSilenceMs = resolveVolcAsrTurnSilenceMs(env);
  }

  protected async run(): Promise<void> {
    try {
      for await (const input of this.input) {
        if (this.abortSignal.aborted) {
          break;
        }

        if (input === VolcAsrSpeechStream.FLUSH_SENTINEL) {
          await this.finalizeActiveTurn("flush");
          continue;
        }

        if (input.samplesPerChannel <= 0) {
          continue;
        }

        const hasSpeech = isLikelySpeechFrame(input);

        if (!this.activeTurn && !hasSpeech) {
          continue;
        }

        const turn = await this.ensureActiveTurn();

        if (turn.upstream.readyState === WebSocket.OPEN) {
          turn.audioFrames += 1;
          turn.upstream.send(createVolcAsrAudioRequest(audioFrameToBuffer(input), false));
        }

        if (hasSpeech) {
          turn.speechFrames += 1;
          turn.trailingSilenceMs = 0;
        } else if (turn.speechFrames > 0) {
          turn.trailingSilenceMs += getAudioFrameDurationMs(input);

          if (turn.trailingSilenceMs >= this.turnSilenceMs) {
            await this.finalizeActiveTurn("silence");
          }
        }
      }
    } finally {
      await this.finalizeActiveTurn("input-end");
    }
  }

  private async ensureActiveTurn(): Promise<NonNullable<VolcAsrSpeechStream["activeTurn"]>> {
    if (this.activeTurn?.upstream.readyState === WebSocket.OPEN) {
      return this.activeTurn;
    }

    this.emittedUtterances.clear();
    const upstream = createVolcAsrWebSocket(this.env);
    const closed = new Promise<void>((resolve, reject) => {
      upstream.on("message", (data) => {
        try {
          this.handleUpstreamMessage(data);
        } catch (error) {
          reject(error);
          upstream.close();
        }
      });
      upstream.once("close", () => resolve());
      upstream.once("error", reject);
    });

    const turn = {
      audioFrames: 0,
      closed,
      finalSent: false,
      speechFrames: 0,
      trailingSilenceMs: 0,
      upstream,
    };
    this.activeTurn = turn;

    await waitForSocketOpen(upstream, this.abortSignal);
    upstream.send(createVolcAsrFullClientRequest());

    return turn;
  }

  private handleUpstreamMessage(data: WebSocket.RawData) {
    const response = parseVolcAsrResponse(data);

    if (response.error) {
      throw new Error(response.error);
    }

    for (const utterance of response.utterances) {
      const text = utterance.text.trim();

      if (!text || !utterance.definite) {
        continue;
      }

      const key = `${utterance.startTime}:${utterance.endTime}:${text}`;

      if (this.emittedUtterances.has(key)) {
        continue;
      }

      this.emittedUtterances.add(key);
      this.emitStartOfSpeech();
      this.emitFinalTranscript(text, utterance.startTime, utterance.endTime);
    }
  }

  private async finalizeActiveTurn(reason: "flush" | "input-end" | "silence") {
    const turn = this.activeTurn;

    if (!turn) {
      this.emitEndOfSpeech();
      return;
    }

    this.activeTurn = undefined;

    try {
      if (turn.upstream.readyState === WebSocket.OPEN && !turn.finalSent) {
        turn.finalSent = true;
        turn.upstream.send(createVolcAsrAudioRequest(Buffer.alloc(0), true));
      }

      await Promise.race([turn.closed, wait(4_000)]);
    } finally {
      const transcriptChunks = this.finalTexts.length;
      if (turn.upstream.readyState === WebSocket.OPEN) {
        turn.upstream.close();
      }
      this.emitEndOfSpeech();
      console.info("[LawTriage LiveKit ASR] finalized turn", {
        audioFrames: turn.audioFrames,
        reason,
        speechFrames: turn.speechFrames,
        transcriptChunks,
      });
    }
  }

  private emitStartOfSpeech() {
    if (this.speaking) {
      return;
    }

    this.speaking = true;
    this.queue.put({
      requestId: this.requestId,
      type: stt.SpeechEventType.START_OF_SPEECH,
    });
  }

  private emitFinalTranscript(text: string, startTimeMs: number, endTimeMs: number) {
    this.finalTexts.push(text);
    this.queue.put({
      alternatives: [
        {
          confidence: 1,
          endTime: this.startTimeOffset + endTimeMs / 1000,
          language: volcAsrLanguage,
          startTime: this.startTimeOffset + startTimeMs / 1000,
          text,
        },
      ],
      requestId: this.requestId,
      type: stt.SpeechEventType.FINAL_TRANSCRIPT,
    });
  }

  private emitEndOfSpeech() {
    if (!this.speaking || this.finalTexts.length === 0) {
      return;
    }

    const text = this.finalTexts.join("");
    this.finalTexts.length = 0;
    this.speaking = false;
    this.queue.put({
      alternatives: [
        {
          confidence: 1,
          endTime: this.startTimeOffset,
          language: volcAsrLanguage,
          startTime: this.startTimeOffset,
          text,
        },
      ],
      requestId: this.requestId,
      type: stt.SpeechEventType.END_OF_SPEECH,
    });
  }
}

function buildArkMessages(chatCtx: llm.ChatContext): ArkChatMessage[] {
  const messages: ArkChatMessage[] = [];

  for (const item of chatCtx.items) {
    if (item.type !== "message") {
      continue;
    }

    const text = item.textContent?.trim();

    if (!text) {
      continue;
    }

    messages.push({
      content: text,
      role: item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : "system",
    });
  }

  if (messages.length === 0) {
    messages.push({
      content: "请生成一句简短、自然的中文开场白。",
      role: "user",
    });
  }

  return messages;
}

async function emitVolcSpeechChunks({
  emit,
  env,
  numChannels,
  sampleRate,
  signal,
  text,
}: {
  emit: (frame: AudioFrame, final: boolean, chunkText: string) => void;
  env: AgentApiEnv;
  numChannels: number;
  sampleRate: number;
  signal: AbortSignal;
  text: string;
}): Promise<void> {
  const maxChars = resolveVolcTtsChunkMaxChars(env);
  const chunks = splitVolcTtsText(text, maxChars);

  if (chunks.length === 0 || signal.aborted) {
    return;
  }

  if (chunks.length > 1) {
    console.info("[LawTriage LiveKit TTS] chunking text", {
      chunks: chunks.length,
      maxChars,
      textLength: text.trim().length,
    });
  }

  for (let index = 0; index < chunks.length; index += 1) {
    if (signal.aborted) {
      return;
    }

    const chunk = chunks[index] ?? "";

    await emitVolcSpeechFrames({
      chunkCount: chunks.length,
      chunkIndex: index + 1,
      emit: (frame, final) => emit(frame, final && index === chunks.length - 1, chunk),
      env,
      numChannels,
      sampleRate,
      signal,
      text: chunk,
    });
  }
}

async function emitVolcSpeechFrames({
  chunkCount,
  chunkIndex,
  emit,
  env,
  numChannels,
  sampleRate,
  signal,
  text,
}: {
  chunkCount: number;
  chunkIndex: number;
  emit: (frame: AudioFrame, final: boolean) => void;
  env: AgentApiEnv;
  numChannels: number;
  sampleRate: number;
  signal: AbortSignal;
  text: string;
}): Promise<void> {
  if (!text.trim() || signal.aborted) {
    return;
  }

  const startedAt = performance.now();
  console.info("[LawTriage LiveKit TTS] request", {
    chunkCount,
    chunkIndex,
    numChannels,
    sampleRate,
    textLength: text.length,
  });
  const audio = await createVolcSpeech(text, env);
  const elapsedMs = Math.round(performance.now() - startedAt);

  if (signal.aborted) {
    console.warn("[LawTriage LiveKit TTS] response ignored after abort", {
      bytes: audio.byteLength,
      chunkCount,
      chunkIndex,
      elapsedMs,
    });
    return;
  }

  console.info("[LawTriage LiveKit TTS] response received", {
    bytes: audio.byteLength,
    chunkCount,
    chunkIndex,
    elapsedMs,
  });
  const path = join(tmpdir(), `lawtriage-volc-tts-${randomUUID()}.mp3`);

  await writeFile(path, audio);

  try {
    const stream = audioFramesFromFile(path, {
      abortSignal: signal,
      format: "mp3",
      numChannels,
      sampleRate,
    });
    let pendingFrame: AudioFrame | undefined;
    let decodedFrames = 0;
    let decodedSamples = 0;

    for await (const frame of stream) {
      if (signal.aborted) {
        return;
      }

      if (pendingFrame) {
        emit(pendingFrame, false);
        decodedFrames += 1;
        decodedSamples += pendingFrame.samplesPerChannel;
      }

      if (!pendingFrame) {
        console.info("[LawTriage LiveKit TTS] first decoded frame", {
          chunkCount,
          chunkIndex,
          sampleRate: frame.sampleRate,
          samplesPerChannel: frame.samplesPerChannel,
        });
      }
      pendingFrame = frame;
    }

    if (pendingFrame) {
      emit(pendingFrame, true);
      decodedFrames += 1;
      decodedSamples += pendingFrame.samplesPerChannel;
    }

    if (decodedFrames === 0) {
      throw new Error("Volcengine TTS returned audio, but no LiveKit audio frames were decoded.");
    }

    console.info("[LawTriage LiveKit TTS] decoded frames completed", {
      audioMs: Math.round((decodedSamples / sampleRate) * 1000),
      chunkCount,
      chunkIndex,
      frames: decodedFrames,
    });
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

function resolveVolcTtsChunkMaxChars(env: AgentApiEnv): number {
  const raw = env.LIVEKIT_AGENT_TTS_CHUNK_MAX_CHARS?.trim();
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;

  if (!Number.isFinite(value)) {
    return defaultVolcTtsChunkMaxChars;
  }

  return Math.min(maxVolcTtsChunkMaxChars, Math.max(minVolcTtsChunkMaxChars, value));
}

function splitVolcTtsText(text: string, maxChars = defaultVolcTtsChunkMaxChars): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const safeMaxChars = Math.min(maxVolcTtsChunkMaxChars, Math.max(minVolcTtsChunkMaxChars, maxChars));

  if (!normalized) {
    return [];
  }

  const pieces = normalized.match(/[^，。！？；、,.!?;]+[，。！？；、,.!?;]?/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const token = piece.trim();

    if (!token) {
      continue;
    }

    if (token.length > safeMaxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }

      chunks.push(...splitLongVolcTtsToken(token, safeMaxChars));
      continue;
    }

    if (current && current.length + token.length > safeMaxChars) {
      chunks.push(current);
      current = token;
      continue;
    }

    current += token;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitLongVolcTtsToken(text: string, maxChars: number): string[] {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }

  return chunks;
}

export const splitVolcTtsTextForTest = splitVolcTtsText;

function audioFrameToBuffer(frame: AudioFrame): Buffer {
  return Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
}

function isLikelySpeechFrame(frame: AudioFrame): boolean {
  let peak = 0;
  let sum = 0;

  for (const sample of frame.data) {
    const value = Math.abs(sample);
    peak = Math.max(peak, value);
    sum += value;
  }

  const average = sum / Math.max(1, frame.data.length);

  return peak > volcAsrSpeechPeakThreshold && average > volcAsrSpeechAverageThreshold;
}

function getAudioFrameDurationMs(frame: AudioFrame): number {
  return (frame.samplesPerChannel / frame.sampleRate) * 1000;
}

function resolveVolcAsrTurnSilenceMs(env: AgentApiEnv): number {
  const parsed = Number(env.LIVEKIT_AGENT_ASR_TURN_SILENCE_MS?.trim());

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultVolcAsrTurnSilenceMs;
  }

  return Math.max(100, parsed);
}

function waitForSocketOpen(socket: WebSocket, signal: AbortSignal): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("LiveKit Agent worker was aborted before Volcengine ASR connected."));
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
