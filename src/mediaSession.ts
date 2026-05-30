import { createMockClientTranscriptEvent, getMockClientTranscriptLength } from "./demoSession";
import type { DemoSession, TranscriptEvent } from "./types";

export type MediaSessionMode = "mock" | "livekit";

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
  private transcriptTimers: number[] = [];

  async connect(session: DemoSession, handlers: MediaSessionHandlers) {
    this.clearTranscriptTimers();
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

    this.scheduleTranscriptEvents(session, handlers);
  }

  async disconnect(handlers?: MediaSessionHandlers) {
    this.clearTranscriptTimers();
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

  private scheduleTranscriptEvents(session: DemoSession, handlers: MediaSessionHandlers) {
    if (!handlers.onTranscriptEvent) {
      return;
    }

    for (let index = 0; index < getMockClientTranscriptLength(); index += 1) {
      const timer = window.setTimeout(() => {
        const event = createMockClientTranscriptEvent(session.intake, index);

        if (event) {
          handlers.onTranscriptEvent?.(event);
        }
      }, 1500 + index * 3200);

      this.transcriptTimers.push(timer);
    }
  }

  private clearTranscriptTimers() {
    for (const timer of this.transcriptTimers) {
      window.clearTimeout(timer);
    }

    this.transcriptTimers = [];
  }
}

class LiveKitMediaSessionAdapter implements MediaSessionAdapter {
  private handlers?: MediaSessionHandlers;
  private room?: LiveKitRoom;

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
        detail: "LiveKit 已连接，麦克风音轨已发布。",
      });
    } catch (error) {
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
