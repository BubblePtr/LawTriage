import { createMockClientTranscriptEvent, getMockClientTranscriptLength } from "./demoSession";
import { getAgentProviderMode, type AgentProviderKind } from "./agentPipeline";
import { lawTriageAgentReplyTopic } from "./livekitTopics";
import type { DemoSession, TranscriptEvent } from "./types";
import type { VoicePipelineEvent } from "./voicePipeline";

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
  onPipelineEvent?: (event: VoicePipelineEvent) => void;
  onStateChange: (state: MediaConnectionState) => void;
  onTranscriptEvent?: (event: TranscriptEvent) => void;
};

export type MediaSessionAdapter = {
  connect: (session: DemoSession, handlers: MediaSessionHandlers) => Promise<void>;
  disconnect: (handlers?: MediaSessionHandlers) => Promise<void>;
};

type LiveKitRoom = import("livekit-client").Room;
type LiveKitRoomEvent = typeof import("livekit-client").RoomEvent;
type LiveKitLocalAudioTrack = import("livekit-client").LocalAudioTrack;
type LiveKitLocalTrackPublication = import("livekit-client").LocalTrackPublication;
type LiveKitParticipant = import("livekit-client").Participant;
type LiveKitRemoteTrack = import("livekit-client").RemoteTrack;
type LiveKitRemoteTrackPublication = import("livekit-client").RemoteTrackPublication;
type LiveKitTrackPublication = import("livekit-client").TrackPublication;
type LiveKitTranscriptionSegment = import("livekit-client").TranscriptionSegment;
type LiveKitTrackPublishOptions = import("livekit-client").TrackPublishOptions;
type LiveKitTextStreamReader = AsyncIterable<string> & {
  info: {
    attributes?: Record<string, string>;
    id: string;
    timestamp: number;
  };
  readAll: () => Promise<string>;
};

type LiveKitAgentReplyStreamPayload = {
  id: string;
  text: string;
  timestamp: number;
};

type LiveKitMicActivityMonitor = {
  analyser: AnalyserNode;
  audioContext: AudioContext;
  intervalId: number;
  source: MediaStreamAudioSourceNode;
};

type LiveKitTokenResponse = {
  expiresAt: string;
  identity: string;
  roomName: string;
  token: string;
  url: string;
};

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
  const liveKitUrl = import.meta.env.VITE_LIVEKIT_URL ?? "";

  return {
    mode: resolveInitialMediaMode(getAgentProviderMode(), liveKitUrl),
    liveKitUrl,
    liveKitToken: "",
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
        : "LiveKit token 将在开始咨询时由本地后端短期签发。",
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
    return undefined;
  }

  return undefined;
}

function resolveInitialMediaMode(agentProviderMode: AgentProviderKind, liveKitUrl: string): MediaSessionMode {
  if (liveKitUrl.trim()) {
    return "livekit";
  }

  return agentProviderMode === "dev" ? "mock" : "browser";
}

function getRealtimeAudioCaptureOptions() {
  return {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  };
}

function getLiveKitMicPublishOptions(): LiveKitTrackPublishOptions {
  return {
    dtx: false,
    red: false,
  };
}

function createLiveKitAudioPlaybackState(playing: boolean, error?: unknown): MediaConnectionState {
  if (playing) {
    return {
      mode: "livekit",
      status: "connected",
      detail: "LiveKit Agent 远端音频播放已恢复。",
    };
  }

  const state: MediaConnectionState = {
    mode: "livekit",
    status: "failed",
    detail: "浏览器阻止了 LiveKit Agent 远端音频播放。",
  };

  if (error !== undefined) {
    state.error = getErrorMessage(error);
  }

  return state;
}

function getLiveKitAudioPlaybackPipelineEvent(
  playing: boolean,
  wasPlaying: boolean,
): {
  event?: VoicePipelineEvent;
  nextWasPlaying: boolean;
} {
  if (playing) {
    return {
      event: {
        detail: "LiveKit Agent 远端音频正在播放。",
        stage: "playback",
        status: "active",
      },
      nextWasPlaying: true,
    };
  }

  if (!wasPlaying) {
    return {
      nextWasPlaying: false,
    };
  }

  return {
    event: {
      detail: "LiveKit Agent 远端音频播放完成。",
      stage: "playback",
      status: "done",
    },
    nextWasPlaying: false,
  };
}

class MockMediaSessionAdapter implements MediaSessionAdapter {
  private transcriptTimers: number[] = [];

  async connect(session: DemoSession, handlers: MediaSessionHandlers) {
    clearTranscriptTimers(this.transcriptTimers);
    handlers.onPipelineEvent?.({
      detail: `正在建立 Dev Mock MediaSession：${session.id}`,
      stage: "media",
      status: "active",
    });
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
    handlers.onPipelineEvent?.({
      detail: "Dev Mock 已接通。",
      stage: "media",
      status: "done",
    });
    handlers.onPipelineEvent?.({
      detail: "使用模拟麦克风输入。",
      stage: "microphone",
      status: "done",
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
    handlers.onPipelineEvent?.({
      detail: `正在打开本机麦克风：${session.id}`,
      stage: "media",
      status: "active",
    });
    handlers.onStateChange({
      mode: "browser",
      status: "connecting",
      detail: `正在打开本机麦克风：${session.id}`,
    });

    const audioTranscription = new BrowserAudioTranscriptionSession("browser");
    this.audioTranscription = audioTranscription;

    try {
      await audioTranscription.start(handlers);
    } catch (error) {
      if (this.audioTranscription === audioTranscription) {
        audioTranscription.stop();
        this.audioTranscription = undefined;
      }

      throw error;
    }

    handlers.onStateChange({
      mode: "browser",
      status: "connected",
      detail: `本机麦克风已接通，${getAsrProviderLabel()} 正在监听。`,
    });
    handlers.onPipelineEvent?.({
      detail: "本机媒体连接已建立。",
      stage: "media",
      status: "done",
    });
    handlers.onPipelineEvent?.({
      detail: "本机麦克风已接通。",
      stage: "microphone",
      status: "done",
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
  private handlers?: MediaSessionHandlers;
  private localMicActivityMonitor?: LiveKitMicActivityMonitor;
  private receivedAgentReplyIds = new Set<string>();
  private receivedTranscriptionSegmentIds = new Set<string>();
  private remoteAudioWasPlaying = false;
  private remoteAudioElements = new Map<
    string,
    {
      element: HTMLMediaElement;
      track: LiveKitRemoteTrack;
    }
  >();
  private room?: LiveKitRoom;
  private transcriptTimers: number[] = [];

  constructor(private readonly config: MediaSessionConfig) {}

  async connect(session: DemoSession, handlers: MediaSessionHandlers) {
    handlers.onPipelineEvent?.({
      detail: `正在连接 LiveKit room：${session.id}`,
      stage: "media",
      status: "active",
    });
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

      const credentials = await resolveLiveKitCredentials(this.config, session);
      await room.connect(credentials.url, credentials.token);
      handlers.onPipelineEvent?.({
        detail: `LiveKit room 已连接：${credentials.roomName}`,
        stage: "media",
        status: "done",
      });
      const microphonePublication = await room.localParticipant.setMicrophoneEnabled(
        true,
        getRealtimeAudioCaptureOptions(),
        getLiveKitMicPublishOptions(),
      );
      this.startLocalMicActivityMonitor(microphonePublication);
      handlers.onPipelineEvent?.({
        detail: "LiveKit 麦克风音轨已发布。",
        stage: "microphone",
        status: "done",
      });

      handlers.onStateChange({
        mode: "livekit",
        status: "connected",
        detail:
          getAgentProviderMode() === "dev"
            ? "LiveKit 已连接，麦克风音轨已发布，演示文本事件流已启动。"
            : `LiveKit 已连接：${credentials.roomName}；等待 LiveKit Agent 入房并发布语音和转写。`,
      });

      if (getAgentProviderMode() === "dev") {
        this.transcriptTimers = scheduleDemoTranscriptEvents(session, handlers);
      }
    } catch (error) {
      this.clearRemoteAudio();
      this.stopLocalMicActivityMonitor();
      this.receivedAgentReplyIds.clear();
      this.receivedTranscriptionSegmentIds.clear();
      this.remoteAudioWasPlaying = false;
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
      handlers.onPipelineEvent?.({
        detail: "LiveKit 连接失败。",
        error: getErrorMessage(error),
        stage: "media",
        status: "failed",
      });
      throw error;
    }
  }

  async disconnect(handlers?: MediaSessionHandlers) {
    const room = this.room;
    const activeHandlers = handlers ?? this.handlers;

    clearTranscriptTimers(this.transcriptTimers);
    this.transcriptTimers = [];
    this.clearRemoteAudio();
    this.stopLocalMicActivityMonitor();
    this.receivedAgentReplyIds.clear();
    this.receivedTranscriptionSegmentIds.clear();
    this.remoteAudioWasPlaying = false;
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
      this.clearRemoteAudio();
      this.stopLocalMicActivityMonitor();
      this.receivedAgentReplyIds.clear();
      this.receivedTranscriptionSegmentIds.clear();
      this.remoteAudioWasPlaying = false;
      handlers.onStateChange({
        mode: "livekit",
        status: "disconnected",
        detail: getLiveKitDisconnectDetail(reason),
      });
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (!participant.isAgent) {
        return;
      }

      emitIfCurrent({
        mode: "livekit",
        status: "connected",
        detail: `LiveKit Agent 已加入房间：${participant.identity}。`,
      });
      handlers.onPipelineEvent?.({
        detail: `LiveKit Agent 已加入房间：${participant.identity}`,
        stage: "asr",
        status: "pending",
      });
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (!participant.isAgent) {
        return;
      }

      emitIfCurrent({
        mode: "livekit",
        status: "connected",
        detail: `LiveKit Agent 已离开房间：${participant.identity}。`,
      });
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (this.room !== room) {
        return;
      }

      this.attachRemoteAudio(room, track, publication, participant.identity);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      this.detachRemoteAudio(track, publication);
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, participant, publication) => {
      if (this.room !== room) {
        return;
      }

      this.emitLiveKitTranscripts(room, segments, participant, publication);
    });

    room.registerTextStreamHandler("lk.transcription", (reader, participantInfo) => {
      void this.handleLiveKitTranscriptionTextStream(
        room,
        reader as LiveKitTextStreamReader,
        participantInfo.identity,
      );
    });

    room.registerTextStreamHandler(lawTriageAgentReplyTopic, (reader) => {
      void this.handleLiveKitAgentReplyTextStream(reader as LiveKitTextStreamReader);
    });

    room.on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
      console.info("[LawTriage LiveKit audio] playback status changed", { playing });
      emitIfCurrent(createLiveKitAudioPlaybackState(playing));
      const playbackPipeline = getLiveKitAudioPlaybackPipelineEvent(playing, this.remoteAudioWasPlaying);

      this.remoteAudioWasPlaying = playbackPipeline.nextWasPlaying;
      if (playbackPipeline.event) {
        handlers.onPipelineEvent?.(playbackPipeline.event);
      }
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

  private attachRemoteAudio(
    room: LiveKitRoom,
    track: LiveKitRemoteTrack,
    publication: LiveKitRemoteTrackPublication,
    participantIdentity: string,
  ) {
    if (track.kind !== "audio") {
      return;
    }

    const trackKey = getRemoteTrackKey(track, publication, participantIdentity);
    console.info("[LawTriage LiveKit audio] remote audio track subscribed", {
      participantIdentity,
      source: publication.source,
      trackKey,
      trackName: publication.trackName,
    });

    if (this.remoteAudioElements.has(trackKey)) {
      return;
    }

    const element = track.attach() as HTMLAudioElement;
    element.autoplay = true;
    element.dataset.livekitTrackId = trackKey;
    element.style.display = "none";
    document.body.appendChild(element);
    this.remoteAudioElements.set(trackKey, { element, track });
    void this.resumeRemoteAudioPlayback(room, element);
  }

  private async resumeRemoteAudioPlayback(room: LiveKitRoom, element: HTMLMediaElement) {
    try {
      await element.play();
      await room.startAudio();
      console.info("[LawTriage LiveKit audio] remote audio playback started", {
        muted: element.muted,
        paused: element.paused,
        readyState: element.readyState,
        volume: element.volume,
      });
    } catch (error) {
      if (this.room !== room) {
        return;
      }

      this.handlers?.onStateChange(createLiveKitAudioPlaybackState(false, error));
    }
  }

  private detachRemoteAudio(track: LiveKitRemoteTrack, publication: LiveKitRemoteTrackPublication) {
    const trackKey = getRemoteTrackKey(track, publication);
    const entry = this.remoteAudioElements.get(trackKey);

    if (entry) {
      entry.track.detach(entry.element);
      entry.element.remove();
      this.remoteAudioElements.delete(trackKey);
      return;
    }

    for (const detachedElement of track.detach()) {
      detachedElement.remove();
    }
  }

  private clearRemoteAudio() {
    for (const { element, track } of this.remoteAudioElements.values()) {
      track.detach(element);
      element.remove();
    }

    this.remoteAudioElements.clear();
  }

  private startLocalMicActivityMonitor(publication?: LiveKitLocalTrackPublication) {
    this.stopLocalMicActivityMonitor();

    const track = publication?.track;

    if (!track || track.kind !== "audio") {
      console.warn("[LawTriage LiveKit mic] microphone publication missing or not audio", {
        hasPublication: Boolean(publication),
      });
      return;
    }

    const mediaStreamTrack = (track as LiveKitLocalAudioTrack).mediaStreamTrack;
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const samples = new Uint8Array(analyser.fftSize);
    let detected = false;
    let sampleCount = 0;

    source.connect(analyser);
    void audioContext.resume().catch((error) => {
      console.warn("[LawTriage LiveKit mic] microphone activity monitor could not resume", getErrorMessage(error));
    });

    const intervalId = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      sampleCount += 1;

      if (!detected && isLiveKitMicAudioActive(samples)) {
        detected = true;
        console.info("[LawTriage LiveKit mic] local microphone audio detected", {
          readyState: mediaStreamTrack.readyState,
          trackEnabled: mediaStreamTrack.enabled,
          trackMuted: mediaStreamTrack.muted,
        });
        return;
      }

      if (!detected && sampleCount === 30) {
        console.warn("[LawTriage LiveKit mic] no local microphone audio detected after sampling", {
          readyState: mediaStreamTrack.readyState,
          trackEnabled: mediaStreamTrack.enabled,
          trackMuted: mediaStreamTrack.muted,
        });
      }
    }, 500);

    this.localMicActivityMonitor = {
      analyser,
      audioContext,
      intervalId,
      source,
    };
  }

  private stopLocalMicActivityMonitor() {
    const monitor = this.localMicActivityMonitor;

    if (!monitor) {
      return;
    }

    window.clearInterval(monitor.intervalId);
    monitor.source.disconnect();
    monitor.analyser.disconnect();
    void monitor.audioContext.close().catch(() => undefined);
    this.localMicActivityMonitor = undefined;
  }

  private emitLiveKitTranscripts(
    room: LiveKitRoom,
    segments: LiveKitTranscriptionSegment[],
    participant?: LiveKitParticipant,
    publication?: LiveKitTrackPublication,
  ) {
    const speaker = getLiveKitTranscriptSpeaker(room, participant, publication);

    if (!shouldAcceptLiveKitTranscriptionSpeaker(speaker)) {
      return;
    }

    for (const segment of segments) {
      const text = normalizeTranscriptText(segment.text);

      if (!segment.final || !text || this.receivedTranscriptionSegmentIds.has(segment.id)) {
        continue;
      }

      this.receivedTranscriptionSegmentIds.add(segment.id);
      this.handlers?.onTranscriptEvent?.({
        id: `lk-${segment.id}`,
        speaker,
        text,
        timestamp: new Date(segment.lastReceivedTime),
      });
      this.handlers?.onPipelineEvent?.({
        detail: "LiveKit 已收到客户最终转写。",
        stage: "asr",
        status: "done",
      });
    }
  }

  private async handleLiveKitTranscriptionTextStream(
    room: LiveKitRoom,
    reader: LiveKitTextStreamReader,
    senderIdentity: string,
  ) {
    const attributes = reader.info.attributes ?? {};
    const segmentId = attributes["lk.segment_id"] || reader.info.id;
    const trackId = attributes["lk.transcribed_track_id"];
    const speaker = getLiveKitTextStreamSpeaker(room, senderIdentity, trackId);

    if (!shouldAcceptLiveKitTranscriptionTextStream(speaker)) {
      await drainLiveKitTextStream(reader);
      return;
    }

    try {
      const text = parseLiveKitTranscriptionStreamText(await reader.readAll());

      if (!text || !shouldEmitLiveKitTextStreamSegment(this.receivedTranscriptionSegmentIds, segmentId)) {
        return;
      }

      console.info("[LawTriage LiveKit transcript] text stream received", {
        final: attributes["lk.transcription_final"],
        segmentId,
        speaker,
        textLength: text.length,
      });
      this.handlers?.onTranscriptEvent?.({
        id: `lk-stream-${segmentId}`,
        speaker,
        text,
        timestamp: new Date(reader.info.timestamp || Date.now()),
      });
    } catch (error) {
      console.warn("[LawTriage LiveKit transcript] text stream failed", getErrorMessage(error));
    }
  }

  private async handleLiveKitAgentReplyTextStream(reader: LiveKitTextStreamReader) {
    try {
      const payload = parseLiveKitAgentReplyStreamText(await reader.readAll());

      if (!payload || !shouldEmitLiveKitAgentReply(this.receivedAgentReplyIds, payload.id)) {
        return;
      }

      console.info("[LawTriage LiveKit transcript] agent reply stream received", {
        id: payload.id,
        textLength: payload.text.length,
      });
      this.handlers?.onPipelineEvent?.({
        detail: "LiveKit Agent 回复文本流已到达。",
        stage: "transcript",
        status: "active",
      });
      this.handlers?.onTranscriptEvent?.(createLiveKitAgentReplyTranscriptEvent(payload));
    } catch (error) {
      console.warn("[LawTriage LiveKit transcript] agent reply stream failed", getErrorMessage(error));
    }
  }

}

async function resolveLiveKitCredentials(
  config: MediaSessionConfig,
  session: DemoSession,
): Promise<LiveKitTokenResponse> {
  const manualToken = config.liveKitToken.trim();
  const manualUrl = config.liveKitUrl.trim();

  if (manualToken && manualUrl) {
    return {
      expiresAt: "",
      identity: "manual-browser",
      roomName: session.id,
      token: manualToken,
      url: manualUrl,
    };
  }

  const response = await fetch("/api/livekit/token", {
    body: JSON.stringify({
      identity: createLiveKitBrowserIdentity(session),
      name: "Demo Browser",
      roomName: createLiveKitRoomName(session),
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "LiveKit token 签发失败。"));
  }

  const payload = (await response.json()) as Partial<LiveKitTokenResponse>;
  const token = payload.token?.trim();
  const url = manualUrl || payload.url?.trim();
  const roomName = payload.roomName?.trim();
  const identity = payload.identity?.trim();

  if (!token || !url || !roomName || !identity) {
    throw new Error("LiveKit token service 返回内容不完整。");
  }

  return {
    expiresAt: payload.expiresAt ?? "",
    identity,
    roomName,
    token,
    url,
  };
}

function createLiveKitRoomName(session: DemoSession): string {
  return `lawtriage-${session.id.toLowerCase()}`;
}

function createLiveKitBrowserIdentity(session: DemoSession): string {
  return `browser-${session.id.toLowerCase()}`;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };

    return payload.error || fallback;
  } catch {
    return fallback;
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

  constructor(
    private readonly mode: MediaSessionMode,
    private readonly inputStream?: MediaStream,
  ) {}

  async start(handlers: MediaSessionHandlers): Promise<void> {
    if (!handlers.onTranscriptEvent) {
      return;
    }

    if (!this.inputStream && !navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风录音。");
    }

    window.addEventListener("lawtriage:tts-start", this.handleTtsStart);
    window.addEventListener("lawtriage:tts-end", this.handleTtsEnd);
    this.stopped = false;
    this.ttsActive = false;

    if (getAgentProviderMode() === "volcengine") {
      await this.startVolcStreamingAsr(handlers);
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      throw new Error("当前浏览器不支持 MediaRecorder。");
    }

    const stream = await this.openAudioInputStream();
    const mimeType = selectAudioMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    this.stream = stream;
    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (this.stopped || this.ttsActive || event.data.size < 800) {
        return;
      }

      handlers.onPipelineEvent?.({
        detail: "检测到本机麦克风音频片段。",
        stage: "speech",
        status: "active",
      });
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

    const stream = await this.openAudioInputStream();
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
        handlers.onPipelineEvent?.({
          detail: "检测到客户语音。",
          stage: "speech",
          status: "active",
        });
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

  private async openAudioInputStream(): Promise<MediaStream> {
    const stream =
      this.inputStream ??
      (await navigator.mediaDevices.getUserMedia({
        audio: getRealtimeAudioCaptureOptions(),
      }));

    if (stream.getAudioTracks().length === 0) {
      throw new Error(`${getMediaInputLabel(this.mode)}没有可用音频轨道。`);
    }

    return stream;
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
    handlers.onPipelineEvent?.({
      detail: "正在连接火山 ASR relay。",
      stage: "asr",
      status: "active",
    });
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
        handlers.onPipelineEvent?.({
          detail: "火山 ASR relay 连接失败。",
          error: getErrorMessage(error),
          stage: "asr",
          status: "failed",
        });
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
          handlers.onPipelineEvent?.({
            detail: "火山 ASR relay 已就绪。",
            stage: "asr",
            status: "active",
          });
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
                detail: `${getMediaInputLabel(this.mode)}已接入，${getAsrProviderLabel()} 等待客户说话。`,
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
    if (this.stopped) {
      return;
    }

    const message = parseAsrSocketMessage(data);

    if (message.type === "error") {
      console.error("[LawTriage ASR] relay error", message.message);
      handlers.onStateChange({
        mode: this.mode,
        status: "failed",
        detail: "火山 ASR 转写失败。",
        error: message.message ?? "火山 ASR 返回错误。",
      });
      handlers.onPipelineEvent?.({
        detail: "火山 ASR 转写失败。",
        error: message.message ?? "火山 ASR 返回错误。",
        stage: "asr",
        status: "failed",
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
    handlers.onPipelineEvent?.({
      detail: "火山 ASR 已返回稳定分句。",
      stage: "asr",
      status: "active",
    });
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
    handlers.onPipelineEvent?.({
      detail: "客户轮次转写已提交。",
      stage: "asr",
      status: "done",
    });
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
        if (this.stopped) {
          return;
        }

        handlers.onStateChange({
          mode: this.mode,
          status: "failed",
          detail: `${getAsrProviderLabel()} 转写失败。`,
          error: getErrorMessage(error),
        });
      });
  }

  private async transcribe(blob: Blob, handlers: MediaSessionHandlers) {
    handlers.onPipelineEvent?.({
      detail: `${getAsrProviderLabel()} 正在转写音频片段。`,
      stage: "asr",
      status: "active",
    });
    const response = await fetch("/api/agent/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    });

    if (this.stopped) {
      return;
    }

    if (!response.ok) {
      const errorMessage = await readAgentApiError(response, "ASR 请求失败。");

      if (this.stopped) {
        return;
      }

      throw new Error(errorMessage);
    }

    const payload = (await response.json()) as { text?: string };

    if (this.stopped) {
      return;
    }

    const text = normalizeTranscriptText(payload.text);

    if (!text || text === this.lastText) {
      return;
    }

    this.lastText = text;
    handlers.onPipelineEvent?.({
      detail: `${getAsrProviderLabel()} 已返回文本。`,
      stage: "asr",
      status: "done",
    });
    if (this.stopped) {
      return;
    }

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
        handlers.onPipelineEvent?.({
          detail: "Dev Mock 生成客户文本事件。",
          stage: "speech",
          status: "active",
        });
        handlers.onPipelineEvent?.({
          detail: "Dev Mock ASR 已产出文本。",
          stage: "asr",
          status: "done",
        });
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

function getMediaInputLabel(mode: MediaSessionMode): string {
  if (mode === "livekit") {
    return "LiveKit 麦克风音轨";
  }

  return "本机麦克风";
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

function getRemoteTrackKey(
  track: LiveKitRemoteTrack,
  publication: LiveKitRemoteTrackPublication,
  participantIdentity = "remote",
): string {
  return publication.trackSid || track.sid || `${participantIdentity}:${publication.trackName}`;
}

function getLiveKitTranscriptSpeaker(
  room: LiveKitRoom,
  participant?: LiveKitParticipant,
  publication?: LiveKitTrackPublication,
): TranscriptEvent["speaker"] {
  if (participant?.identity === room.localParticipant.identity) {
    return "client";
  }

  if (publication && isLocalTrackPublication(room, publication)) {
    return "client";
  }

  return "agent";
}

function getLiveKitTextStreamSpeaker(
  room: LiveKitRoom,
  senderIdentity: string,
  trackId?: string,
): TranscriptEvent["speaker"] {
  if (senderIdentity === room.localParticipant.identity) {
    return "client";
  }

  if (trackId && isLocalTrackId(room, trackId)) {
    return "client";
  }

  return "agent";
}

function isLocalTrackPublication(room: LiveKitRoom, publication: LiveKitTrackPublication): boolean {
  const trackSid = publication.trackSid;

  return !!trackSid && isLocalTrackId(room, trackSid);
}

function isLocalTrackId(room: LiveKitRoom, trackId: string): boolean {
  for (const localPublication of room.localParticipant.trackPublications.values()) {
    if (localPublication.trackSid === trackId) {
      return true;
    }
  }

  return false;
}

function parseLiveKitTranscriptionStreamText(payload: string): string {
  const normalizedPayload = payload.trim();

  if (!normalizedPayload) {
    return "";
  }

  const lines = normalizedPayload.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const jsonTexts: string[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { text?: unknown };

      if (typeof parsed.text !== "string") {
        return normalizeTranscriptText(payload);
      }

      jsonTexts.push(parsed.text);
    } catch {
      return normalizeTranscriptText(payload);
    }
  }

  return normalizeTranscriptText(jsonTexts.join(""));
}

function shouldEmitLiveKitTextStreamSegment(seenSegmentIds: Set<string>, segmentId: string): boolean {
  if (seenSegmentIds.has(segmentId)) {
    return false;
  }

  seenSegmentIds.add(segmentId);
  return true;
}

function shouldAcceptLiveKitTranscriptionSpeaker(speaker: TranscriptEvent["speaker"]): boolean {
  return speaker === "client";
}

function shouldAcceptLiveKitTranscriptionTextStream(_speaker: TranscriptEvent["speaker"]): boolean {
  return false;
}

async function drainLiveKitTextStream(reader: LiveKitTextStreamReader): Promise<void> {
  try {
    await reader.readAll();
  } catch {
    return;
  }
}

function isLiveKitMicAudioActive(samples: Uint8Array): boolean {
  let peak = 0;
  let total = 0;

  for (const sample of samples) {
    const deviation = Math.abs(sample - 128);
    peak = Math.max(peak, deviation);
    total += deviation;
  }

  return peak >= 20 && total / samples.length >= 4;
}

function parseLiveKitAgentReplyStreamText(payload: string): LiveKitAgentReplyStreamPayload | undefined {
  const normalizedPayload = payload.trim();

  if (!normalizedPayload) {
    return undefined;
  }

  const parsed = JSON.parse(normalizedPayload) as {
    id?: unknown;
    role?: unknown;
    text?: unknown;
    timestamp?: unknown;
  };

  if (parsed.role !== "assistant" || typeof parsed.id !== "string" || typeof parsed.text !== "string") {
    return undefined;
  }

  const text = normalizeTranscriptText(parsed.text);

  if (!text) {
    return undefined;
  }

  return {
    id: parsed.id,
    text,
    timestamp: typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp) ? parsed.timestamp : Date.now(),
  };
}

function shouldEmitLiveKitAgentReply(seenReplyIds: Set<string>, replyId: string): boolean {
  if (seenReplyIds.has(replyId)) {
    return false;
  }

  seenReplyIds.add(replyId);
  return true;
}

function createLiveKitAgentReplyTranscriptEvent(
  payload: LiveKitAgentReplyStreamPayload,
  receivedAt = new Date(),
): TranscriptEvent {
  return {
    id: `lk-agent-${payload.id}`,
    speaker: "agent",
    text: payload.text,
    timestamp: receivedAt,
  };
}

export const createLiveKitAgentReplyTranscriptEventForTest = createLiveKitAgentReplyTranscriptEvent;
export const parseLiveKitAgentReplyStreamTextForTest = parseLiveKitAgentReplyStreamText;
export const parseLiveKitTranscriptionStreamTextForTest = parseLiveKitTranscriptionStreamText;
export const resolveInitialMediaModeForTest = resolveInitialMediaMode;
export const createLiveKitAudioPlaybackStateForTest = createLiveKitAudioPlaybackState;
export const getLiveKitAudioPlaybackPipelineEventForTest = getLiveKitAudioPlaybackPipelineEvent;
export const getLiveKitMicPublishOptionsForTest = getLiveKitMicPublishOptions;
export const isLiveKitMicAudioActiveForTest = isLiveKitMicAudioActive;
export const shouldAcceptLiveKitTranscriptionSpeakerForTest = shouldAcceptLiveKitTranscriptionSpeaker;
export const shouldAcceptLiveKitTranscriptionTextStreamForTest = shouldAcceptLiveKitTranscriptionTextStream;
export const shouldEmitLiveKitAgentReplyForTest = shouldEmitLiveKitAgentReply;
export const shouldEmitLiveKitTextStreamSegmentForTest = shouldEmitLiveKitTextStreamSegment;
export function getLiveKitTextStreamSpeakerForTest(
  senderIdentity: string,
  localIdentity: string,
  localTrackMatched = false,
): TranscriptEvent["speaker"] {
  if (senderIdentity === localIdentity || localTrackMatched) {
    return "client";
  }

  return "agent";
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
