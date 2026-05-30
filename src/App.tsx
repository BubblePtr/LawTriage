import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  LayoutDashboard,
  Mic,
  Pause,
  Phone,
  PhoneCall,
  PhoneOff,
  Play,
  RadioTower,
  Scale,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultAgentProviders,
  createInitialAgentState,
} from "./agentPipeline";
import {
  appendTranscriptEvent,
  createAgentTranscriptEvent,
  createDemoSession,
  endDemoSession,
  formatDateTime,
  formatDuration,
  formatTranscriptTime,
  getMockTranscriptLength,
} from "./demoSession";
import {
  createDemoScenarioSnapshot,
  demoFixtures,
  getDefaultDemoFixture,
  getDemoFixture,
} from "./demoFixtures";
import {
  formatMissingTriageSlots,
  getTriageSlotValue,
} from "./triageSlots";
import {
  createInitialMediaConfig,
  createInitialMediaState,
  createMediaSessionAdapter,
  validateMediaSessionConfig,
} from "./mediaSession";
import type { CallStatus, DemoSession, IntakeForm, StructuredResult, TranscriptEvent, TriageSlotKey } from "./types";
import type { AgentRuntimeState } from "./agentPipeline";
import type { MediaConnectionState, MediaSessionAdapter, MediaSessionConfig } from "./mediaSession";

const defaultFixture = getDefaultDemoFixture();
const initialIntake: IntakeForm = { ...defaultFixture.intake };

const agentProviders = createDefaultAgentProviders();

function App() {
  const [selectedFixtureId, setSelectedFixtureId] = useState(defaultFixture.id);
  const [intake, setIntake] = useState<IntakeForm>(initialIntake);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [agentState, setAgentState] = useState<AgentRuntimeState>(() =>
    createInitialAgentState(agentProviders),
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [mediaConfig, setMediaConfig] = useState<MediaSessionConfig>(() => createInitialMediaConfig());
  const [mediaState, setMediaState] = useState<MediaConnectionState>(() =>
    createInitialMediaState(createInitialMediaConfig()),
  );
  const [mediaTransitionPending, setMediaTransitionPending] = useState(false);
  const agentTurnQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mediaSessionRef = useRef<MediaSessionAdapter | null>(null);
  const pendingMediaSessionRef = useRef<MediaSessionAdapter | null>(null);
  const mediaTransitionPendingRef = useRef(false);
  const sessionRef = useRef<DemoSession | null>(null);
  const selectedFixture = useMemo(() => getDemoFixture(selectedFixtureId), [selectedFixtureId]);
  const selectedScenario = useMemo(() => createDemoScenarioSnapshot(selectedFixture), [selectedFixture]);

  const status: CallStatus = session?.status ?? "idle";
  const canStart = !mediaTransitionPending && status !== "active" && isValidIntake(intake);
  const canEnd = !mediaTransitionPending && status === "active";
  const mediaConfigLocked = mediaTransitionPending || status === "active";
  const transcriptEvents = session?.transcript ?? [];
  const latestTranscriptEvent = transcriptEvents.at(-1);
  const transcriptProgress = `${transcriptEvents.length}/${getMockTranscriptLength(
    session?.scenario ?? selectedScenario,
  )}`;

  useEffect(() => {
    if (!session || session.status !== "active") {
      return;
    }

    setElapsedSeconds(Math.max(0, getSecondsBetween(session.startedAt, new Date())));
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, getSecondsBetween(session.startedAt, new Date())));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    return () => {
      void mediaSessionRef.current?.disconnect();
      void pendingMediaSessionRef.current?.disconnect();
    };
  }, []);

  const dashboardDuration = useMemo(() => {
    if (!session) {
      return "00:00";
    }

    if (session.status === "ended" && session.endedAt) {
      return formatDuration(getSecondsBetween(session.startedAt, session.endedAt));
    }

    return formatDuration(elapsedSeconds);
  }, [elapsedSeconds, session]);

  function updateIntake(field: keyof IntakeForm, value: string) {
    setIntake((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateSelectedFixture(fixtureId: string) {
    if (mediaConfigLocked || mediaTransitionPendingRef.current) {
      return;
    }

    const fixture = getDemoFixture(fixtureId);
    setSelectedFixtureId(fixture.id);
    setIntake({ ...fixture.intake });
    commitSession(null);
    setElapsedSeconds(0);
    setAgentState(createInitialAgentState(agentProviders));
  }

  function updateMediaConfig(field: keyof MediaSessionConfig, value: string) {
    if (mediaConfigLocked || mediaTransitionPendingRef.current) {
      return;
    }

    setMediaConfig((current) => {
      const next = {
        ...current,
        [field]: value,
      };

      setMediaState(createInitialMediaState(next));

      return next;
    });
  }

  function setMediaTransition(nextPending: boolean) {
    mediaTransitionPendingRef.current = nextPending;
    setMediaTransitionPending(nextPending);
  }

  function commitSession(nextSession: DemoSession | null) {
    sessionRef.current = nextSession;
    setSession(nextSession);
  }

  function enqueueMediaTranscriptEvent(event: TranscriptEvent) {
    const turn = agentTurnQueueRef.current
      .then(() => processMediaTranscriptEvent(event))
      .catch((error) => {
        setAgentState({
          providerLabel: agentProviders.label,
          status: "failed",
          detail: "Agent 处理媒体文本事件失败。",
          error: getErrorMessage(error),
        });
      });

    agentTurnQueueRef.current = turn;
    void turn;
  }

  async function processMediaTranscriptEvent(event: TranscriptEvent) {
    const currentSession = sessionRef.current;

    if (!currentSession || currentSession.status !== "active") {
      return;
    }

    const acceptedEvent = await agentProviders.asr.acceptTextEvent(event);
    const latestBeforeInputCommit = sessionRef.current;

    if (
      !latestBeforeInputCommit ||
      latestBeforeInputCommit.id !== currentSession.id ||
      latestBeforeInputCommit.status !== "active"
    ) {
      return;
    }

    const sessionWithInput = appendTranscriptEvent(latestBeforeInputCommit, acceptedEvent);
    commitSession(sessionWithInput);

    if (acceptedEvent.speaker !== "client") {
      return;
    }

    setAgentState({
      providerLabel: agentProviders.label,
      status: "thinking",
      detail: "Agent 正在生成接待回复。",
    });

    try {
      const turnIndex = sessionWithInput.transcript.filter((item) => item.speaker === "client").length;
      const replyText = await agentProviders.llm.generateReply({
        clientEvent: acceptedEvent,
        session: sessionWithInput,
        transcript: sessionWithInput.transcript,
        turnIndex,
      });
      const latestSession = sessionRef.current;

      if (!latestSession || latestSession.status !== "active") {
        return;
      }

      setAgentState({
        providerLabel: agentProviders.label,
        status: "speaking",
        detail: "Agent 回复已生成，正在写回字幕流。",
      });
      await agentProviders.tts.synthesize(replyText);

      const sessionWithReply = appendTranscriptEvent(
        latestSession,
        createAgentTranscriptEvent(replyText, new Date(Date.now() + 120)),
      );
      commitSession(sessionWithReply);
      setAgentState({
        providerLabel: agentProviders.label,
        status: "listening",
        detail: "Agent 已回复，等待下一句客户输入。",
        lastReplyAt: new Date(),
      });
    } catch (error) {
      setAgentState({
        providerLabel: agentProviders.label,
        status: "failed",
        detail: "Agent 回复生成失败。",
        error: getErrorMessage(error),
      });
    }
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canStart || mediaTransitionPendingRef.current) {
      return;
    }

    const validationError = validateMediaSessionConfig(mediaConfig);

    if (validationError) {
      setMediaState({
        mode: mediaConfig.mode,
        status: "failed",
        detail: "RTC 配置不完整。",
        error: validationError,
      });
      return;
    }

    const nextSession = createDemoSession(intake, selectedScenario);
    const adapter = createMediaSessionAdapter(mediaConfig);
    pendingMediaSessionRef.current = adapter;
    setMediaTransition(true);
    setMediaState({
      mode: mediaConfig.mode,
      status: "connecting",
      detail: "正在准备 RTC 媒体连接。",
    });

    try {
      await adapter.connect(nextSession, {
        onStateChange: (nextState) => {
          if (pendingMediaSessionRef.current === adapter || mediaSessionRef.current === adapter) {
            setMediaState(nextState);
          }
        },
        onTranscriptEvent: (event) => {
          if (pendingMediaSessionRef.current === adapter || mediaSessionRef.current === adapter) {
            enqueueMediaTranscriptEvent(event);
          }
        },
      });
      if (pendingMediaSessionRef.current !== adapter) {
        await adapter.disconnect();
        return;
      }

      mediaSessionRef.current = adapter;
      pendingMediaSessionRef.current = null;
      setAgentState({
        providerLabel: agentProviders.label,
        status: "thinking",
        detail: "Agent 正在生成开场话术。",
      });

      const openingText = await agentProviders.llm.generateReply({
        session: nextSession,
        transcript: nextSession.transcript,
        turnIndex: 0,
      });
      await agentProviders.tts.synthesize(openingText);
      commitSession(appendTranscriptEvent(nextSession, createAgentTranscriptEvent(openingText)));
      setAgentState({
        providerLabel: agentProviders.label,
        status: "listening",
        detail: "Agent 已开场，等待客户输入。",
        lastReplyAt: new Date(),
      });
      setElapsedSeconds(0);
    } catch (error) {
      await adapter.disconnect().catch(() => undefined);
      if (pendingMediaSessionRef.current === adapter) {
        pendingMediaSessionRef.current = null;
      }
      if (mediaSessionRef.current === adapter) {
        mediaSessionRef.current = null;
      }
      setAgentState({
        providerLabel: agentProviders.label,
        status: "failed",
        detail: "Agent 或 RTC 启动失败。",
        error: getErrorMessage(error),
      });
      setMediaState({
        mode: mediaConfig.mode,
        status: "failed",
        detail: "RTC 或 Agent 启动失败。",
        error: getErrorMessage(error),
      });
    } finally {
      if (pendingMediaSessionRef.current === adapter) {
        pendingMediaSessionRef.current = null;
      }
      setMediaTransition(false);
    }
  }

  async function handleEndCall() {
    if (!session || session.status !== "active" || mediaTransitionPendingRef.current) {
      return;
    }

    const activeSession = sessionRef.current;
    const adapter = mediaSessionRef.current;

    if (!activeSession || activeSession.status !== "active") {
      return;
    }

    setMediaTransition(true);
    setMediaState({
      mode: mediaConfig.mode,
      status: "disconnecting",
      detail: "正在断开 RTC 媒体连接。",
    });

    try {
      commitSession(endDemoSession(activeSession));
      await adapter?.disconnect({
        onStateChange: (nextState) => {
          if (!adapter || mediaSessionRef.current === adapter) {
            setMediaState(nextState);
          }
        },
      });
    } finally {
      if (!adapter || mediaSessionRef.current === adapter) {
        mediaSessionRef.current = null;
      }
      setMediaState({
        mode: mediaConfig.mode,
        status: "disconnected",
        detail: "RTC 媒体连接已断开，转写和结构化结果已保留。",
      });
      setAgentState({
        providerLabel: agentProviders.label,
        status: "idle",
        detail: "演示会话已结束。",
      });
      setMediaTransition(false);
    }
  }

  return (
    <main className="app-shell">
      <TopBar />
      <nav className="workspace-nav" aria-label="主导航">
        <a className="nav-item nav-item-active" href="#workspace">
          <LayoutDashboard size={16} />
          工作台
        </a>
        <a className="nav-item" href="#call">
          <PhoneCall size={16} />
          通话记录
        </a>
        <a className="nav-item" href="#profile">
          <UserRound size={16} />
          客户档案
        </a>
        <a className="nav-item" href="#result">
          <FileText size={16} />
          结果导出
        </a>
      </nav>

      <section className="workspace" id="workspace">
        <aside className="intake-panel" aria-label="客户信息录入和通话控制">
          <form className="panel-section" onSubmit={handleStart}>
            <SectionTitle icon={<FileText size={18} />} title="客户信息录入" />
            <Field label="演示用例">
              <select
                aria-label="演示用例"
                disabled={mediaConfigLocked}
                value={selectedFixtureId}
                onChange={(event) => updateSelectedFixture(event.target.value)}
              >
                {demoFixtures.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="fixture-note">{selectedFixture.description}</p>
            <Field label="手机号码" required>
              <input
                aria-label="手机号码"
                value={intake.phone}
                onChange={(event) => updateIntake("phone", event.target.value)}
                placeholder="请输入手机号"
              />
            </Field>
            <Field label="案件类型" required>
              <select
                aria-label="案件类型"
                value={intake.caseType}
                onChange={(event) => updateIntake("caseType", event.target.value)}
              >
                <option value="婚姻家事">婚姻家事</option>
              </select>
            </Field>
            <Field label="客户姓名" required>
              <input
                aria-label="客户姓名"
                value={intake.clientName}
                onChange={(event) => updateIntake("clientName", event.target.value)}
                placeholder="请输入称呼"
              />
            </Field>
            <Field label="所在城市" required>
              <input
                aria-label="所在城市"
                value={intake.city}
                onChange={(event) => updateIntake("city", event.target.value)}
                placeholder="请输入城市"
              />
            </Field>
            <button className="primary-action" type="submit" disabled={!canStart}>
              <Phone size={18} />
              开始咨询
            </button>
          </form>

          <section className="panel-section rtc-panel" aria-label="RTC 接入">
            <SectionTitle icon={<RadioTower size={18} />} title="RTC 接入" />
            <Field label="媒体模式">
              <select
                aria-label="媒体模式"
                disabled={mediaConfigLocked}
                value={mediaConfig.mode}
                onChange={(event) => updateMediaConfig("mode", event.target.value)}
              >
                <option value="mock">Dev Mock</option>
                <option value="livekit">LiveKit</option>
              </select>
            </Field>
            {mediaConfig.mode === "livekit" ? (
              <>
                <Field label="LiveKit URL">
                  <input
                    aria-label="LiveKit URL"
                    disabled={mediaConfigLocked}
                    value={mediaConfig.liveKitUrl}
                    onChange={(event) => updateMediaConfig("liveKitUrl", event.target.value)}
                    placeholder="wss://your-project.livekit.cloud"
                  />
                </Field>
                <Field label="Participant Token">
                  <input
                    aria-label="Participant Token"
                    disabled={mediaConfigLocked}
                    value={mediaConfig.liveKitToken}
                    onChange={(event) => updateMediaConfig("liveKitToken", event.target.value)}
                    placeholder="由 token service 签发的短期 token"
                    type="password"
                  />
                </Field>
              </>
            ) : null}
            <div className="rtc-status-row">
              <span>连接状态</span>
              <MediaStatusBadge state={mediaState} />
            </div>
            <p className={mediaState.error ? "rtc-detail rtc-detail-error" : "rtc-detail"}>
              {mediaState.error ?? mediaState.detail}
            </p>
          </section>

          <section className="panel-section call-control" aria-label="通话控制">
            <SectionTitle icon={<PhoneCall size={18} />} title="通话控制" />
            <MetricRow label="通话状态" value={<StatusBadge status={status} />} />
            <MetricRow label="通话时长" value={dashboardDuration} />
            <MetricRow label="呼叫方式" value="RTC 浏览器音频" />
            <MetricRow label="RTC 模式" value={mediaConfig.mode === "mock" ? "Dev Mock" : "LiveKit"} />
            <MetricRow label="Agent 模式" value={agentState.providerLabel} />
            <MetricRow label="Agent 状态" value={getAgentStatusLabel(agentState.status)} />
            <MetricRow label="坐席/机器人" value="AI 助理-小华" />
            <div className="control-actions">
              <button className="secondary-action" type="button" disabled>
                <Mic size={17} />
                静音
              </button>
              <button className="danger-action" type="button" disabled={!canEnd} onClick={handleEndCall}>
                <PhoneOff size={17} />
                结束通话
              </button>
            </div>
          </section>

          <p className={agentState.error ? "operator-note operator-note-error" : "operator-note"}>
            {agentState.error ?? agentState.detail}
          </p>
        </aside>

        <section className="session-panel" aria-label="当前会话">
          <div className="session-header">
            <SectionTitle icon={<PhoneCall size={18} />} title="当前会话" />
            <StatusBadge status={status} />
          </div>
          <div className="session-metrics">
            <MetricBlock label="会话 ID" value={session?.id ?? "-"} />
            <MetricBlock label="开始时间" value={formatDateTime(session?.startedAt)} />
            <MetricBlock label="通话状态" value={getStatusLabel(status)} />
            <MetricBlock label="通话时长" value={dashboardDuration} />
          </div>
          <div className="transcript-area">
            <div className="transcript-toolbar">
              <span className="toolbar-title">
                <FileText size={16} />
                实时通话转写
              </span>
              <span className="toolbar-caption">
                {status === "active" ? `Agent 对话 ${transcriptProgress}` : `转写事件 ${transcriptProgress}`}
              </span>
            </div>
            <TranscriptFeed events={transcriptEvents} status={status} />
            <ClientCaptionPreview event={latestTranscriptEvent} />
          </div>
          <div className="session-footer">
            {status === "active" ? "AI 助理正在与客户通话中，请勿随意打断。" : "结束通话后，右侧档案会自动更新。"}
          </div>
        </section>

        <aside className="result-panel" aria-label="通话结果">
          <div className="result-heading">
            <SectionTitle icon={<ShieldCheck size={18} />} title="通话结束后自动生成档案" />
            <span>{session?.status === "ended" ? "已生成" : "等待通话结束"}</span>
          </div>
          <ResultSections result={session?.structuredResult} />
        </aside>
      </section>
    </main>
  );
}

function TopBar() {
  return (
    <header className="top-bar">
      <div className="brand">
        <div className="brand-mark">
          <Scale size={20} />
        </div>
        <div>
          <strong>华诚律师事务所</strong>
          <span>AI 外呼接待演示系统（MVP）</span>
        </div>
      </div>
      <div className="top-actions">
        <span className="online-dot">
          <span />
          系统在线
        </span>
        <span className="clock-label">
          <Clock3 size={16} />
          演示工作台
        </span>
      </div>
    </header>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="section-title">
      {icon}
      {title}
    </h2>
  );
}

function Field({
  children,
  label,
  required,
}: {
  children: React.ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? <em>*</em> : null}
      </span>
      {children}
    </label>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="metric-block">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: CallStatus }) {
  return <span className={`status-badge status-${status}`}>{getStatusLabel(status)}</span>;
}

function MediaStatusBadge({ state }: { state: MediaConnectionState }) {
  return (
    <span className={`media-status media-status-${state.status}`}>
      {getMediaStatusLabel(state.status)}
    </span>
  );
}

function ResultSections({ result }: { result?: StructuredResult }) {
  return (
    <div className="result-sections">
      <ResultSection
        icon={<UserRound size={18} />}
        title="客户档案"
        rows={[
          ["客户姓名", result?.clientProfile.name],
          ["联系电话", result?.clientProfile.phone],
          ["案件类型", result?.clientProfile.caseType],
          ["所在城市", result?.clientProfile.city],
          ["核心诉求", result?.clientProfile.coreNeed],
          ["是否已有律师", result?.clientProfile.hasLawyer],
        ]}
      />
      <ResultSection
        icon={<FileText size={18} />}
        title="分诊槽位"
        rows={[
          ["档案完整度", formatSlotCompletion(result)],
          ["缺失字段", formatMissingResultSlots(result)],
          ["争议金额/标的", getResultSlotValue(result, "disputeAmount")],
          ["紧急程度", getResultSlotValue(result, "urgency")],
          ["期望沟通时间", getResultSlotValue(result, "expectedContactTime")],
        ]}
      />
      <ResultSection
        icon={<CheckCircle2 size={18} />}
        title="案件分级"
        rows={[
          ["分级结果", result?.grading.level],
          ["判断依据", result?.grading.reason],
        ]}
      />
      <ResultSection
        icon={<CalendarClock size={18} />}
        title="预约信息"
        rows={[
          ["是否预约", result?.appointment.needed],
          ["预约时间", result?.appointment.time],
          ["预约地点", result?.appointment.location],
        ]}
      />
      <ResultSection
        icon={<AlertTriangle size={18} />}
        title="风险标记"
        tone="danger"
        rows={[
          ["风险类型", result?.risk.level],
          ["风险说明", result?.risk.note],
        ]}
      />
      <RecordingArchiveSection result={result} />
      <TranscriptArchiveSection result={result} />
    </div>
  );
}

function RecordingArchiveSection({ result }: { result?: StructuredResult }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const recording = result?.recording;

  async function togglePlayback() {
    const audio = audioRef.current;

    if (!audio || !recording) {
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
    // Browser automation may not grant transient activation for audio playback.
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      return;
    }

    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  }

  return (
    <section className="result-section recording-section">
      <h3>
        <Archive size={18} />
        录音归档
      </h3>
      <dl>
        <div>
          <dt>归档编号</dt>
          <dd>{recording?.id ?? "-"}</dd>
        </div>
        <div>
          <dt>绑定会话</dt>
          <dd>{recording?.sessionId ?? "-"}</dd>
        </div>
        <div>
          <dt>录音时长</dt>
          <dd>{recording ? formatDuration(recording.durationSeconds) : "-"}</dd>
        </div>
      </dl>
      <div className="recording-controls">
        <button className="audio-action" type="button" disabled={!recording} onClick={togglePlayback}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          {isPlaying ? "暂停" : "播放"}
        </button>
        <span>{recording?.label ?? "等待通话结束"}</span>
      </div>
      {recording ? (
        <audio
          ref={audioRef}
          onEnded={() => setIsPlaying(false)}
          preload="metadata"
          src={recording.url}
        />
      ) : null}
    </section>
  );
}

function TranscriptArchiveSection({ result }: { result?: StructuredResult }) {
  return (
    <section className="result-section transcript-archive-section">
      <h3>
        <ClipboardList size={18} />
        完整转写
      </h3>
      <dl>
        <div>
          <dt>转写行数</dt>
          <dd>{result ? `${result.transcript.lineCount} 条` : "-"}</dd>
        </div>
        <div>
          <dt>转写摘要</dt>
          <dd>{result?.transcript.summary ?? "-"}</dd>
        </div>
      </dl>
      <pre className="transcript-archive-text">{result?.transcript.fullText || "等待通话结束"}</pre>
    </section>
  );
}

function formatSlotCompletion(result?: StructuredResult): string | undefined {
  if (!result?.triageSlots) {
    return undefined;
  }

  return `${result.triageSlots.completedCount}/${result.triageSlots.totalCount}`;
}

function formatMissingResultSlots(result?: StructuredResult): string | undefined {
  if (!result?.triageSlots) {
    return undefined;
  }

  return formatMissingTriageSlots(result.triageSlots);
}

function getResultSlotValue(result: StructuredResult | undefined, key: TriageSlotKey): string | undefined {
  if (!result?.triageSlots) {
    return undefined;
  }

  return getTriageSlotValue(result.triageSlots, key);
}

function TranscriptFeed({ events, status }: { events: TranscriptEvent[]; status: CallStatus }) {
  if (events.length === 0) {
    return (
      <div className="transcript-empty">
        <FileText size={56} />
        <strong>{getTranscriptTitle(status)}</strong>
        <span>{getTranscriptHint(status)}</span>
      </div>
    );
  }

  return (
    <ol className="transcript-feed" aria-label="实时通话转写">
      {events.map((event) => (
        <li className={`transcript-line transcript-${event.speaker}`} key={event.id}>
          <div className="transcript-meta">
            <span>{getTranscriptSpeakerLabel(event)}</span>
            <time dateTime={event.timestamp.toISOString()}>{formatTranscriptTime(event.timestamp)}</time>
          </div>
          <p>{event.text}</p>
        </li>
      ))}
    </ol>
  );
}

function ClientCaptionPreview({ event }: { event?: TranscriptEvent }) {
  return (
    <div className="client-caption-preview" aria-label="当事人端字幕预览">
      <span>当事人端字幕预览</span>
      <strong>{event ? `${getTranscriptSpeakerLabel(event)}：${event.text}` : "等待会话字幕事件"}</strong>
    </div>
  );
}

function ResultSection({
  icon,
  rows,
  title,
  tone = "default",
}: {
  icon: React.ReactNode;
  rows: Array<[string, string | undefined]>;
  title: string;
  tone?: "default" | "danger";
}) {
  return (
    <section className="result-section">
      <h3 className={tone === "danger" ? "danger-title" : undefined}>
        {icon}
        {title}
      </h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? "-"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function getSecondsBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 1000);
}

function isValidIntake(intake: IntakeForm): boolean {
  return Boolean(intake.phone.trim() && intake.clientName.trim() && intake.city.trim());
}

function getStatusLabel(status: CallStatus): string {
  if (status === "active") {
    return "通话中";
  }

  if (status === "ended") {
    return "已结束";
  }

  return "待开始";
}

function getMediaStatusLabel(status: MediaConnectionState["status"]): string {
  if (status === "connecting") {
    return "连接中";
  }

  if (status === "connected") {
    return "已连接";
  }

  if (status === "failed") {
    return "连接失败";
  }

  if (status === "disconnecting") {
    return "断开中";
  }

  if (status === "disconnected") {
    return "已断开";
  }

  return "未连接";
}

function getAgentStatusLabel(status: AgentRuntimeState["status"]): string {
  if (status === "listening") {
    return "监听中";
  }

  if (status === "thinking") {
    return "生成中";
  }

  if (status === "speaking") {
    return "写回中";
  }

  if (status === "failed") {
    return "异常";
  }

  return "待开始";
}

function getTranscriptTitle(status: CallStatus): string {
  if (status === "active") {
    return "会话已创建，等待实时字幕接入";
  }

  if (status === "ended") {
    return "本通演示已结束";
  }

  return "通话开始后，实时转写内容将显示在此处";
}

function getTranscriptHint(status: CallStatus): string {
  if (status === "active") {
    return "等待客户文本事件触发 AI 回复。";
  }

  if (status === "ended") {
    return "右侧已生成结构化档案占位结果。";
  }

  return "填写客户信息并点击开始咨询。";
}

function getTranscriptSpeakerLabel(event: TranscriptEvent): string {
  return event.speaker === "agent" ? "AI 分诊 Agent" : "当事人";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
