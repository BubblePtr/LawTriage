import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  LayoutDashboard,
  Mic,
  Phone,
  PhoneCall,
  PhoneOff,
  RadioTower,
  Scale,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  appendTranscriptEvent,
  createDemoSession,
  createMockTranscriptEvent,
  endDemoSession,
  formatDateTime,
  formatDuration,
  formatTranscriptTime,
  getMockTranscriptLength,
} from "./demoSession";
import {
  createInitialMediaConfig,
  createInitialMediaState,
  createMediaSessionAdapter,
  validateMediaSessionConfig,
} from "./mediaSession";
import type { CallStatus, DemoSession, IntakeForm, StructuredResult, TranscriptEvent } from "./types";
import type { MediaConnectionState, MediaSessionAdapter, MediaSessionConfig } from "./mediaSession";

const initialIntake: IntakeForm = {
  phone: "138 0013 8000",
  caseType: "婚姻家事",
  clientName: "李女士",
  city: "上海市",
};

function App() {
  const [intake, setIntake] = useState<IntakeForm>(initialIntake);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [mediaConfig, setMediaConfig] = useState<MediaSessionConfig>(() => createInitialMediaConfig());
  const [mediaState, setMediaState] = useState<MediaConnectionState>(() =>
    createInitialMediaState(createInitialMediaConfig()),
  );
  const mediaSessionRef = useRef<MediaSessionAdapter | null>(null);

  const status: CallStatus = session?.status ?? "idle";
  const canStart = status !== "active" && isValidIntake(intake);
  const canEnd = status === "active";
  const transcriptEvents = session?.transcript ?? [];
  const latestTranscriptEvent = transcriptEvents.at(-1);
  const transcriptProgress = `${transcriptEvents.length}/${getMockTranscriptLength()}`;

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
    };
  }, []);

  useEffect(() => {
    if (!session || session.status !== "active") {
      return;
    }

    if (session.transcript.length >= getMockTranscriptLength()) {
      return;
    }

    const delay = session.transcript.length === 0 ? 700 : 1700;
    const timer = window.setTimeout(() => {
      setSession((current) => {
        if (!current || current.status !== "active") {
          return current;
        }

        const event = createMockTranscriptEvent(current.intake, current.transcript.length);

        if (!event) {
          return current;
        }

        return appendTranscriptEvent(current, event);
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [session]);

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

  function updateMediaConfig(field: keyof MediaSessionConfig, value: string) {
    setMediaConfig((current) => {
      const next = {
        ...current,
        [field]: value,
      };

      setMediaState(createInitialMediaState(next));

      return next;
    });
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canStart) {
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

    const nextSession = createDemoSession(intake);
    const adapter = createMediaSessionAdapter(mediaConfig);
    mediaSessionRef.current = adapter;

    try {
      await adapter.connect(nextSession, {
        onStateChange: setMediaState,
      });
      setSession(nextSession);
      setElapsedSeconds(0);
    } catch {
      mediaSessionRef.current = null;
    }
  }

  async function handleEndCall() {
    if (!session || session.status !== "active") {
      return;
    }

    setSession(endDemoSession(session));
    await mediaSessionRef.current?.disconnect();
    mediaSessionRef.current = null;
    setMediaState({
      mode: mediaConfig.mode,
      status: "disconnected",
      detail: "RTC 媒体连接已断开，转写和结构化结果已保留。",
    });
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
                disabled={status === "active"}
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
                    disabled={status === "active"}
                    value={mediaConfig.liveKitUrl}
                    onChange={(event) => updateMediaConfig("liveKitUrl", event.target.value)}
                    placeholder="wss://your-project.livekit.cloud"
                  />
                </Field>
                <Field label="Participant Token">
                  <input
                    aria-label="Participant Token"
                    disabled={status === "active"}
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
            <p className={mediaState.status === "failed" ? "rtc-detail rtc-detail-error" : "rtc-detail"}>
              {mediaState.error ?? mediaState.detail}
            </p>
          </section>

          <section className="panel-section call-control" aria-label="通话控制">
            <SectionTitle icon={<PhoneCall size={18} />} title="通话控制" />
            <MetricRow label="通话状态" value={<StatusBadge status={status} />} />
            <MetricRow label="通话时长" value={dashboardDuration} />
            <MetricRow label="呼叫方式" value="RTC 浏览器音频" />
            <MetricRow label="RTC 模式" value={mediaConfig.mode === "mock" ? "Dev Mock" : "LiveKit"} />
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

          <p className="operator-note">提示：开始咨询后将创建演示 session，并在结束通话后生成档案占位结果。</p>
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
                {status === "active" ? `模拟字幕播放中 ${transcriptProgress}` : `转写事件 ${transcriptProgress}`}
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
      <ResultSection
        icon={<FileText size={18} />}
        title="完整转写"
        rows={[
          ["转写行数", result ? `${result.transcript.lineCount} 条` : undefined],
          ["转写摘要", result?.transcript.summary],
          ["最新内容", result?.transcript.events.at(-1)?.text],
        ]}
      />
    </div>
  );
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

  if (status === "disconnected") {
    return "已断开";
  }

  return "未连接";
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
    return "当前切片先跑通 session 闭环；下一切片接入 transcript 事件。";
  }

  if (status === "ended") {
    return "右侧已生成结构化档案占位结果。";
  }

  return "填写客户信息并点击开始咨询。";
}

function getTranscriptSpeakerLabel(event: TranscriptEvent): string {
  return event.speaker === "agent" ? "AI 分诊 Agent" : "当事人";
}

export default App;
