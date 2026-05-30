import type { DemoSession, TranscriptEvent } from "./types";

export type MediaSessionMode = "mock" | "livekit";

export type MediaConnectionStatus = "idle" | "connecting" | "connected" | "failed" | "disconnected";

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
  disconnect: () => Promise<void>;
};

export function createInitialMediaConfig(): MediaSessionConfig {
  return {
    mode: hasLiveKitDefaults() ? "livekit" : "mock",
    liveKitUrl: import.meta.env.VITE_LIVEKIT_URL ?? "",
    liveKitToken: import.meta.env.VITE_LIVEKIT_TOKEN ?? "",
  };
}

export function createInitialMediaState(config: MediaSessionConfig): MediaConnectionState {
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

  return new MockMediaSessionAdapter();
}

export function validateMediaSessionConfig(config: MediaSessionConfig): string | undefined {
  if (config.mode === "mock") {
    return undefined;
  }

  if (!config.liveKitUrl.trim()) {
    return "缺少 LiveKit URL。";
  }

  if (!config.liveKitToken.trim()) {
    return "缺少 LiveKit participant token。";
  }

  return undefined;
}

function hasLiveKitDefaults(): boolean {
  return Boolean(import.meta.env.VITE_LIVEKIT_URL && import.meta.env.VITE_LIVEKIT_TOKEN);
}

class MockMediaSessionAdapter implements MediaSessionAdapter {
  async connect(session: DemoSession, handlers: MediaSessionHandlers) {
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
  }

  async disconnect() {
    await wait(120);
  }
}

class LiveKitMediaSessionAdapter implements MediaSessionAdapter {
  private room?: import("livekit-client").Room;

  constructor(private readonly config: MediaSessionConfig) {}

  async connect(session: DemoSession, handlers: MediaSessionHandlers) {
    handlers.onStateChange({
      mode: "livekit",
      status: "connecting",
      detail: `正在连接 LiveKit room：${session.id}`,
    });

    try {
      const { Room } = await import("livekit-client");
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      await room.connect(this.config.liveKitUrl.trim(), this.config.liveKitToken.trim());
      await room.localParticipant.setMicrophoneEnabled(true);
      this.room = room;

      handlers.onStateChange({
        mode: "livekit",
        status: "connected",
        detail: "LiveKit 已连接，麦克风音轨已发布。",
      });
    } catch (error) {
      handlers.onStateChange({
        mode: "livekit",
        status: "failed",
        detail: "LiveKit 连接失败。",
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async disconnect() {
    this.room?.disconnect();
    this.room = undefined;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
