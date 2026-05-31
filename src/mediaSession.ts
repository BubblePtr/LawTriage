import { createMockClientTranscriptEvent, getMockClientTranscriptLength } from "./demoSession";
import { getAgentProviderMode } from "./agentPipeline";
import type { DemoSession, TranscriptEvent } from "./types";

export type MediaSessionMode = "mock" | "browser" | "livekit";

export type MediaConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "disconnecting"
  | "disconnected";

export type MediaSessionConfig = {
  mode: MediaSessionMode;
  liveKitUrl: string;
  liveKitToken: string;
};

export type MediaConnectionState = {
  mode: MediaSessionMode;
  status: MediaConnectionStatus;
  detail: string;
  error?: string;
};

export type MediaSessionHandlers = {
  onStateChange: (state: MediaConnectionState) => void;
  onTranscriptEvent?: (event: TranscriptEvent) => void;
};

export type MediaSessionAdapter = {
  connect: (session: DemoSession, handlers: MediaSessionHandlers) => Promise<void>;
  disconnect: (handlers?: MediaSessionHandlers) => Promise<void>;
};

type LiveKitRoom = import("livekit-client").Room;
type LiveKitRoomEvent = typeof import("livekit-client").RoomEvent;

type AsrSocketMessage =
  | {
      type: "ready";
    }
  | {
      definite?: boolean;
      message?: string;
      text?: string;
      type: "result";
    }
  | {
      message?: string;
      type: "error";
    };

export function createInitialMediaConfig(): MediaSessionConfig {
  return {
    mode: getAgentProviderMode() !== "dev" ? "browser" : hasLiveKitDefaults() ? "livekit" : "mock",
    liveKitUrl: import.meta.env.VITE_LIVEKIT_URL ?? "",
    liveKitToken: import.meta.env.VITE_LIVEKIT_TOKEN ?? "",
  };
}

export function createInitialMediaState(config: MediaSessionConfig): MediaConnectionState {
  if (config.mode === "browser") {
    return {
      mode: config.mode,
      status: "idle",
      detail: "本机麦克风可用，真实 Agent provider 将监听浏览器音频。",
    };
  }

  return {
    mode: config.mode,
    status: "idle",
    detail:
      config.mode === "mock"
        ? "Dev Mock 可用，无需 RTC 凭证。"
        : "等待 LiveKit participant token。",
  };
}

export function createMediaSessionAdapter(config: MediaSessionConfig): MediaSessionAdapter {
  if (config.mode === "livekit") {
    return new LiveKitMediaSessionAdapter(config);
  }

  if (config.mode === "browser") {
    return new BrowserMicMediaSessionAdapter();
  }

  return new MockMediaSessionAdapter();
}

export function validateMediaSessionConfig(config: MediaSessionConfig): string | undefined {
  if (config.mode === "mock") {
    return undefined;
  }

  if (config.mode === "browser") {
    return getAgentProviderMode() === "dev"
      ? "本机麦克风需要 VITE_AGENT_PROVIDER=openai 或 volcengine。"
      : undefined;
  }

  if (config.mode === "livekit") {
    if (!config.liveKitUrl.trim()) {
      return "缺少 LiveKit URL。";
    }

    if (!config.liveKitToken.trim()) {
      return "缺少 LiveKit participant token。";
    }

    return undefined;
  }

  return undefined;
}

function hasLiveKitDefaults(): boolean {
  return Boolean(import.meta.env.VITE_LIVEKIT_URL && import.meta.env.VITE_LIVEKIT_TOKEN);
}

class MockMediaSessionAdapter implements MediaSessionAdapter {
  private transcriptTimers: number[] = [];

  async connect(session: DemoSession, handlers: MediaSessionHandlers) {
    clearTranscriptTimers(this.transcriptTimers);
    handlers.onStateChange({
      mode: "mock",
      status: "connecting",
      detail: `正在建立 Dev Mock MediaSession：${session.id}`,
    });

    await wait(320);

    handlers.onStateChange({
      mode: "mock",
      status: "connected",
      detail: "Dev Mock 已接通，浏览器音频链路由模拟字幕事件驱动。",
    });

    this.transcriptTimers = scheduleDemoTranscriptEvents(session, handlers);
  }

  async disconnect(handlers?: MediaSessionHandlers) {
    clearTranscriptTimers(this.transcriptTimers);
    this.transcriptTimers = [];
    handlers?.onStateChange({
      mode: "mock",
      status: "disconnecting",
      detail: "正在断开 Dev Mock MediaSession。",
    });

    await wait(120);

    handlers?.onStateChange({
      mode: "mock",
      status: "disconnected",
      detail: "Dev Mock MediaSession 已断开。",
    });
  }
}

class BrowserMicMediaSessionAdapter implements MediaSessionAdapter {
  private audioTranscription?: BrowserAudioTranscriptionSession;

  async connect(session: DemoSession, handlers: MediaSessionHandlers) {
    this.audioTranscription?.stop();
    this.audioTranscription = undefined;
    handlers.onStateChange({
      mode: "browser",
      status: "connecting",
      detail: `正在打开本机麦克风：${session.id}`,
    });

    this.audioTranscription = new BrowserAudioTranscriptionSession("browser");
    await this.audioTranscription.start(handlers);

    handlers.onStateChange({
      mode: "browser",
      status: "connected",
      detail: `本机麦克风已接通，${getAsrProviderLabel()} 正在监听。`,
    });
  }

  async disconnect(handlers?: MediaSessionHandlers) {
    this.audioTranscription?.stop();
    this.audioTranscription = undefined;
    handlers?.onStateChange({
      mode: "browser",
      status: "disconnecting",
      detail: "正在关闭本机麦克风。",
    });

    await wait(80);

    handlers?.onStateChange({
      mode: "browser",
      status: "disconnected",
      detail: "本机麦克风已关闭。",
    });
  }
}

class LiveKitMediaSessionAdapter implements MediaSessionAdapter {
  private audioTranscription?: BrowserAudioTranscriptionSession;
  private handlers?: MediaSessionHandlers;
  private room?: LiveKitRoom;
  private transcriptTimers: number[] = [];

  constructor(private readonly config: MediaSessionConfig) {}

  async connect(session: DemoSession, handlers: MediaSessionHandlers) {
    handlers.onStateChange({
      mode: "livekit",
      status: "connecting",
      detail: `正在连接 LiveKit room：${session.id}`,
    });

    let room: LiveKitRoom | undefined;

    try {
      const { Room, RoomEvent } = await import("livekit-client");
      room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      this.room = room;
      this.handlers = handlers;
      this.bindRoomLifecycle(room, handlers, RoomEvent);

      await room.connect(this.config.liveKitUrl.trim(), this.config.liveKitToken.trim());
      await room.localParticipant.setMicrophoneEnabled(true);

      handlers.onStateChange({
        mode: "livekit",
        status: "connected",
        detail:
          shouldUseBrowserAudioTranscription()
            ? `LiveKit 已连接，麦克风音轨已发布，${getAsrProviderLabel()} 正在监听。`
            : "LiveKit 已连接，麦克风音轨已发布，演示文本事件流已启动。",
      });

      if (shouldUseBrowserAudioTranscription()) {
        this.audioTranscription = new BrowserAudioTranscriptionSession("livekit");
        await this.audioTranscription.start(handlers);
        return;
      }

      this.transcriptTimers = scheduleDemoTranscriptEvents(session, handlers);
    } catch (error) {
      this.audioTranscription?.stop();
      this.audioTranscription = undefined;
      clearTranscriptTimers(this.transcriptTimers);
      this.transcriptTimers = [];
      if (room) {
        room.removeAllListeners();
        room.disconnect();
      }

      if (this.room === room) {
        this.room = undefined;
      }
      if (this.handlers === handlers) {
        this.handlers = undefined;
      }

      handlers.onStateChange({
        mode: "livekit",
        status: "disconnected",
        detail: "LiveKit 连接失败，已断开临时 room。",
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async disconnect(handlers?: MediaSessionHandlers) {
    const room = this.room;
    const activeHandlers = handlers ?? this.handlers;

    clearTranscriptTimers(this.transcriptTimers);
    this.transcriptTimers = [];
    this.audioTranscription?.stop();
    this.audioTranscription = undefined;
    activeHandlers?.onStateChange({
      mode: "livekit",
      status: "disconnecting",
      detail: "正在断开 LiveKit 媒体连接。",
    });

    if (room) {
      this.room = undefined;
      room.removeAllListeners();
      room.disconnect();
    }

    activeHandlers?.onStateChange({
      mode: "livekit",
      status: "disconnected",
      detail: "LiveKit 媒体连接已断开。",
    });

    this.handlers = undefined;
  }

  private bindRoomLifecycle(room: LiveKitRoom, handlers: MediaSessionHandlers, RoomEvent: LiveKitRoomEvent) {
    const emitIfCurrent = (state: MediaConnectionState) => {
      if (this.room !== room) {
        return;
      }

      handlers.onStateChange(state);
    };

    room.on(RoomEvent.Reconnecting, () => {
      emitIfCurrent({
        mode: "livekit",
        status: "connecting",
        detail: "LiveKit 连接中断，正在重连。",
      });
    });

    room.on(RoomEvent.SignalReconnecting, () => {
      emitIfCurrent({
        mode: "livekit",
        status: "connecting",
        detail: "LiveKit 信令连接中断，正在恢复。",
      });
    });

    room.on(RoomEvent.Reconnected, () => {
      emitIfCurrent({
        mode: "livekit",
        status: "connected",
        detail: "LiveKit 已重连，麦克风音轨保持发布。",
      });
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.room !== room) {
        return;
      }

      this.room = undefined;
      this.handlers = undefined;
      clearTranscriptTimers(this.transcriptTimers);
      this.transcriptTimers = [];
      this.audioTranscription?.stop();
      this.audioTranscription = undefined;
      handlers.onStateChange({
        mode: "livekit",
        status: "disconnected",
        detail: getLiveKitDisconnectDetail(reason),
      });
    });

    room.on(RoomEvent.MediaDevicesError, (error) => {
      emitIfCurrent({
        mode: "livekit",
        status: "failed",
        detail: "LiveKit 媒体设备发生错误。",
        error: getErrorMessage(error),
      });
    });
  }
}

class BrowserAudioTranscriptionSession {
  private readonly handleTtsEnd = () => {
    this.ttsActive = false;
  };
  private readonly handleTtsStart = () => {
    this.ttsActive = true;
    this.clearPendingPcm();
    this.clearOutboundPcm();
    this.clearPendingClientTurn();
    this.finalizeAsrSocket("tts-start");
  };
  private audioContext?: AudioContext;
  private audioNode?: ScriptProcessorNode;
  private audioSource?: MediaStreamAudioSourceNode;
  private asrConnecting?: Promise<void>;
  private asrFinalizing = false;
  private asrSocket?: WebSocket;
  private firstSpeechLogged = false;
  private firstSentPcmLogged = false;
  private hasSpeechInCurrentStream = false;
  private clientTurnFlushTimer?: number;
  private lastDefiniteAt = 0;
  private lastText = "";
  private lastVoiceAt = 0;
  private outboundPcm: ArrayBuffer[] = [];
  private pendingPcm: Int16Array[] = [];
  private pendingSampleCount = 0;
  private pendingTurnTexts: string[] = [];
  private processing = Promise.resolve();
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private stopped = true;
  private ttsActive = false;

  constructor(private readonly mode: MediaSessionMode) {}

  async start(handlers: MediaSessionHandlers): Promise<void> {
    if (!handlers.onTranscriptEvent) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风录音。");
    }

    window.addEventListener("lawtriage:tts-start", this.handleTtsStart);
    window.addEventListener("lawtriage:tts-end", this.handleTtsEnd);
    this.stopped = false;
    this.ttsActive = getAgentProviderMode() !== "dev";

    if (getAgentProviderMode() === "volcengine") {
      await this.startVolcStreamingAsr(handlers);
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      throw new Error("当前浏览器不支持 MediaRecorder。");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const mimeType = selectAudioMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    this.stream = stream;
    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (this.stopped || this.ttsActive || event.data.size < 800) {
        return;
      }

      this.enqueueTranscription(event.data, handlers);
    };
    recorder.start(4200);
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("lawtriage:tts-start", this.handleTtsStart);
    window.removeEventListener("lawtriage:tts-end", this.handleTtsEnd);
    this.clearPendingPcm();
    this.clearOutboundPcm();
    this.clearPendingClientTurn();
    this.closeAsrSocketNow();
    this.firstSpeechLogged = false;
    this.firstSentPcmLogged = false;

    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }

    this.audioNode?.disconnect();
    this.audioSource?.disconnect();
    void this.audioContext?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.asrFinalizing = false;
    this.asrConnecting = undefined;
    this.asrSocket = undefined;
    this.audioContext = undefined;
    this.audioNode = undefined;
    this.audioSource = undefined;
    this.recorder = undefined;
    this.stream = undefined;
  }

  private async startVolcStreamingAsr(handlers: MediaSessionHandlers) {
    const AudioContextCtor = getAudioContextConstructor();

    if (!AudioContextCtor) {
      throw new Error("当前浏览器不支持 Web Audio。");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const audioContext = new AudioContextCtor();
    const audioSource = audioContext.createMediaStreamSource(stream);
    const audioNode = audioContext.createScriptProcessor(4096, 1, 1);

    this.audioContext = audioContext;
    this.audioSource = audioSource;
    this.audioNode = audioNode;
    this.stream = stream;

    audioNode.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);

      if (this.stopped || this.ttsActive || this.asrFinalizing) {
        this.clearPendingPcm();
        return;
      }

      const pcm = resampleTo16Khz(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
      const hasSpeech = isLikelySpeech(pcm);
      const now = performance.now();

      if (!this.hasActiveAsrSocket() && !this.asrConnecting && !hasSpeech) {
        return;
      }

      if (hasSpeech) {
        this.hasSpeechInCurrentStream = true;
        this.lastVoiceAt = now;
      }

      if (hasSpeech && !this.firstSpeechLogged) {
        this.firstSpeechLogged = true;
        console.info("[LawTriage ASR] speech detected, opening ASR relay");
      }

      this.enqueuePcm(pcm, handlers);

      if (this.hasSpeechInCurrentStream && !hasSpeech && now - this.lastVoiceAt > 1800) {
        this.finalizeAsrSocket("silence");
      }
    };

    audioSource.connect(audioNode);
    audioNode.connect(audioContext.destination);
    await audioContext.resume();
  }

  private ensureAsrSocket(handlers: MediaSessionHandlers): WebSocket | undefined {
    if (this.asrSocket?.readyState === WebSocket.OPEN) {
      return this.asrSocket;
    }

    if (this.asrConnecting) {
      return undefined;
    }

    const socket = new WebSocket(getLocalAsrWebSocketUrl());
    socket.binaryType = "arraybuffer";
    this.asrSocket = socket;
    this.asrFinalizing = false;
    console.info("[LawTriage ASR] relay connecting");
    this.asrConnecting = this.waitForVolcAsrReady(socket, handlers)
      .then(() => {
        if (this.asrSocket === socket && socket.readyState === WebSocket.OPEN) {
          this.flushOutboundPcm();
        }
      })
      .catch((error) => {
        if (!this.stopped) {
          handlers.onStateChange({
            mode: this.mode,
            status: "failed",
            detail: "火山 ASR relay 连接失败。",
            error: getErrorMessage(error),
          });
        }
        this.clearOutboundPcm();
        if (this.asrSocket === socket) {
          this.asrSocket = undefined;
        }
      })
      .finally(() => {
        if (this.asrSocket === socket) {
          this.asrConnecting = undefined;
        }
      });

    return undefined;
  }

  private waitForVolcAsrReady(socket: WebSocket, handlers: MediaSessionHandlers): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("火山 ASR relay 连接超时。"));
      }, 8000);

      const cleanup = () => {
        window.clearTimeout(timeout);
      };

      socket.onmessage = (event) => {
        const message = parseAsrSocketMessage(event.data);

        if (message.type === "ready") {
          cleanup();
          console.info("[LawTriage ASR] relay ready");
          socket.onmessage = (nextEvent) => this.handleVolcAsrMessage(nextEvent.data, handlers);
          socket.onerror = () => {
            if (!this.stopped) {
              handlers.onStateChange({
                mode: this.mode,
                status: "failed",
                detail: "火山 ASR relay 连接失败。",
              });
            }
          };
          socket.onclose = () => {
            if (this.asrSocket === socket) {
              this.asrSocket = undefined;
              this.asrConnecting = undefined;
              this.asrFinalizing = false;
              this.hasSpeechInCurrentStream = false;
              this.firstSpeechLogged = false;
              this.firstSentPcmLogged = false;
            }

            if (!this.stopped) {
              handlers.onStateChange({
                mode: this.mode,
                status: "connected",
                detail: `本机麦克风已接通，${getAsrProviderLabel()} 等待客户说话。`,
              });
            }
          };
          resolve();
          return;
        }

        this.handleVolcAsrMessage(event.data, handlers);
      };

      socket.onerror = () => {
        cleanup();
        reject(new Error("火山 ASR relay 连接失败。"));
      };

      socket.onclose = () => {
        if (!this.stopped) {
          cleanup();
          reject(new Error("火山 ASR relay 在就绪前关闭。"));
        }
      };
    });
  }

  private handleVolcAsrMessage(data: unknown, handlers: MediaSessionHandlers) {
    const message = parseAsrSocketMessage(data);

    if (message.type === "error") {
      console.error("[LawTriage ASR] relay error", message.message);
      handlers.onStateChange({
        mode: this.mode,
        status: "failed",
        detail: "火山 ASR 转写失败。",
        error: message.message ?? "火山 ASR 返回错误。",
      });
      return;
    }

    if (message.type !== "result" || !message.definite) {
      return;
    }

    const text = normalizeTranscriptText(message.text);

    if (!text || text === this.lastText) {
      return;
    }

    console.info("[LawTriage ASR] definite transcript", text);
    this.lastDefiniteAt = performance.now();
    this.lastText = text;
    this.queueClientTurnText(text, handlers);
  }

  private queueClientTurnText(text: string, handlers: MediaSessionHandlers) {
    this.pendingTurnTexts.push(text);
    this.scheduleClientTurnFlush(handlers);
  }

  private scheduleClientTurnFlush(handlers: MediaSessionHandlers) {
    if (this.clientTurnFlushTimer) {
      window.clearTimeout(this.clientTurnFlushTimer);
    }

    const pendingText = normalizeTranscriptText(this.pendingTurnTexts.join(" "));
    const delay = getClientTurnSilenceMs(pendingText);

    this.clientTurnFlushTimer = window.setTimeout(() => {
      this.flushClientTurnIfIdle(handlers);
    }, delay);
  }

  private flushClientTurnIfIdle(handlers: MediaSessionHandlers) {
    if (this.pendingTurnTexts.length === 0 || this.stopped) {
      return;
    }

    const pendingText = normalizeTranscriptText(this.pendingTurnTexts.join(" "));
    const requiredSilence = getClientTurnSilenceMs(pendingText);
    const now = performance.now();
    const elapsedSinceDefinite = now - this.lastDefiniteAt;
    const elapsedSinceVoice = now - this.lastVoiceAt;

    if (elapsedSinceDefinite < requiredSilence) {
      this.clientTurnFlushTimer = window.setTimeout(() => {
        this.flushClientTurnIfIdle(handlers);
      }, Math.max(250, requiredSilence - elapsedSinceDefinite));
      return;
    }

    if (elapsedSinceVoice < getRecentVoiceHoldMs()) {
      this.clientTurnFlushTimer = window.setTimeout(() => {
        this.flushClientTurnIfIdle(handlers);
      }, Math.max(250, getRecentVoiceHoldMs() - elapsedSinceVoice));
      return;
    }

    if (this.asrConnecting || this.asrFinalizing) {
      this.clientTurnFlushTimer = window.setTimeout(() => {
        this.flushClientTurnIfIdle(handlers);
      }, 250);
      return;
    }

    this.clearPendingClientTurn();

    if (!pendingText) {
      return;
    }

    console.info("[LawTriage ASR] client turn flushed", pendingText);
    handlers.onTranscriptEvent?.({
      id: `tr-${Date.now()}-volc-${Math.random().toString(16).slice(2, 6)}`,
      speaker: "client",
      text: pendingText,
      timestamp: new Date(),
    });
  }

  private clearPendingClientTurn() {
    if (this.clientTurnFlushTimer) {
      window.clearTimeout(this.clientTurnFlushTimer);
    }

    this.clientTurnFlushTimer = undefined;
    this.pendingTurnTexts = [];
  }

  private enqueuePcm(pcm: Int16Array, handlers: MediaSessionHandlers) {
    if (pcm.length === 0) {
      return;
    }

    this.pendingPcm.push(pcm);
    this.pendingSampleCount += pcm.length;

    if (this.pendingSampleCount < 3200) {
      return;
    }

    const chunk = new Int16Array(this.pendingSampleCount);
    let offset = 0;

    for (const segment of this.pendingPcm) {
      chunk.set(segment, offset);
      offset += segment.length;
    }

    this.clearPendingPcm();
    this.sendPcmChunk(chunk, handlers);
  }

  private clearPendingPcm() {
    this.pendingPcm = [];
    this.pendingSampleCount = 0;
  }

  private clearOutboundPcm() {
    this.outboundPcm = [];
  }

  private closeAsrSocketNow() {
    const socket = this.asrSocket;

    if (!socket) {
      return;
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "end" }));
      socket.close();
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }

    this.asrSocket = undefined;
    this.asrConnecting = undefined;
    this.asrFinalizing = false;
  }

  private finalizeAsrSocket(reason: string) {
    const socket = this.asrSocket;

    if (!socket || this.asrFinalizing) {
      return;
    }

    if (socket.readyState === WebSocket.OPEN) {
      console.info("[LawTriage ASR] finalizing relay", reason);
      this.asrFinalizing = true;
      socket.send(JSON.stringify({ type: "end" }));
      window.setTimeout(() => {
        if (this.asrSocket === socket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      }, 4500);
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.close();
      this.asrSocket = undefined;
      this.asrConnecting = undefined;
      this.asrFinalizing = false;
    }
  }

  private flushOutboundPcm() {
    const socket = this.asrSocket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const chunk of this.outboundPcm) {
      socket.send(chunk);
    }

    this.clearOutboundPcm();
  }

  private hasActiveAsrSocket(): boolean {
    return this.asrSocket?.readyState === WebSocket.OPEN && !this.asrFinalizing;
  }

  private sendPcmChunk(chunk: Int16Array, handlers: MediaSessionHandlers) {
    const payload = new ArrayBuffer(chunk.byteLength);
    new Int16Array(payload).set(chunk);
    const socket = this.ensureAsrSocket(handlers);

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.outboundPcm.push(payload);
      return;
    }

    if (!this.firstSentPcmLogged) {
      this.firstSentPcmLogged = true;
      console.info("[LawTriage ASR] first PCM chunk sent", payload.byteLength);
    }

    socket.send(payload);
  }

  private enqueueTranscription(blob: Blob, handlers: MediaSessionHandlers) {
    this.processing = this.processing
      .then(() => this.transcribe(blob, handlers))
      .catch((error) => {
        handlers.onStateChange({
          mode: this.mode,
          status: "failed",
          detail: `${getAsrProviderLabel()} 转写失败。`,
          error: getErrorMessage(error),
        });
      });
  }

  private async transcribe(blob: Blob, handlers: MediaSessionHandlers) {
    const response = await fetch("/api/agent/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    });

    if (!response.ok) {
      throw new Error(await readAgentApiError(response, "ASR 请求失败。"));
    }

    const payload = (await response.json()) as { text?: string };
    const text = normalizeTranscriptText(payload.text);

    if (!text || text === this.lastText) {
      return;
    }

    this.lastText = text;
    handlers.onTranscriptEvent?.({
      id: `tr-${Date.now()}-asr-${Math.random().toString(16).slice(2, 6)}`,
      speaker: "client",
      text,
      timestamp: new Date(),
    });
  }
}

function scheduleDemoTranscriptEvents(session: DemoSession, handlers: MediaSessionHandlers): number[] {
  if (!handlers.onTranscriptEvent) {
    return [];
  }

  const timers: number[] = [];

  for (let index = 0; index < getMockClientTranscriptLength(session); index += 1) {
    const timer = window.setTimeout(() => {
      const event = createMockClientTranscriptEvent(session, index);

      if (event) {
        handlers.onTranscriptEvent?.(event);
      }
    }, 1500 + index * 3200);

    timers.push(timer);
  }

  return timers;
}

function clearTranscriptTimers(timers: number[]) {
  for (const timer of timers) {
    window.clearTimeout(timer);
  }
}

function selectAudioMimeType(): string | undefined {
  const candidates = [
    "audio/ogg;codecs=opus",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function getLocalAsrWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${window.location.host}/api/agent/asr`;
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function resampleTo16Khz(input: Float32Array, sourceRate: number): Int16Array {
  if (sourceRate === 16000) {
    return floatTo16BitPcm(input);
  }

  const ratio = sourceRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const lower = Math.floor(sourceIndex);
    const upper = Math.min(lower + 1, input.length - 1);
    const weight = sourceIndex - lower;
    output[index] = input[lower] * (1 - weight) + input[upper] * weight;
  }

  return floatTo16BitPcm(output);
}

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

function isLikelySpeech(pcm: Int16Array): boolean {
  let peak = 0;
  let sum = 0;

  for (const sample of pcm) {
    const value = Math.abs(sample);
    peak = Math.max(peak, value);
    sum += value;
  }

  const average = sum / Math.max(1, pcm.length);

  return peak > 500 && average > 35;
}

function getClientTurnSilenceMs(text: string): number {
  const normalized = normalizeTranscriptText(text);

  if (normalized.length > 0 && normalized.length <= 4 && !/[吗呢？?]$/.test(normalized)) {
    return 3000;
  }

  return 1600;
}

function getRecentVoiceHoldMs(): number {
  return 650;
}

function parseAsrSocketMessage(data: unknown): AsrSocketMessage {
  try {
    const raw = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);

    return JSON.parse(raw) as AsrSocketMessage;
  } catch {
    return {
      message: "无法解析火山 ASR relay 消息。",
      type: "error",
    };
  }
}

function normalizeTranscriptText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function shouldUseBrowserAudioTranscription(): boolean {
  return getAgentProviderMode() !== "dev";
}

function getAsrProviderLabel(): string {
  const mode = getAgentProviderMode();

  if (mode === "volcengine") {
    return "火山 ASR";
  }

  if (mode === "openai") {
    return "OpenAI ASR";
  }

  return "Dev ASR";
}

async function readAgentApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };

    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

function getLiveKitDisconnectDetail(reason: unknown): string {
  if (reason === undefined) {
    return "LiveKit 媒体连接已断开。";
  }

  return `LiveKit 媒体连接已断开：${String(reason)}。`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
