import {
  createTriageSlotSnapshot,
  formatMissingTriageSlots,
  getTriageSlotValue,
} from "./triageSlots";
import type {
  DemoSession,
  IntakeForm,
  StructuredResult,
  TranscriptEvent,
  TranscriptSpeaker,
  TriageSlotSnapshot,
} from "./types";

const sessionDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const transcriptTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const mockClientTranscriptScript: Array<(intake: IntakeForm) => string> = [
  (intake) => `你好，我是${intake.clientName}，人在${intake.city}，想咨询离婚和财产分割的问题。`,
  () => "已经分居三个月，有一套共同房产，还有一个孩子，主要担心对方转移存款。",
  () => "房子大概四百万，还有几十万存款。我想尽快跟律师聊一下。",
  () => "可以，那帮我安排明天下午沟通吧。",
];

export function getMockClientTranscriptLength(): number {
  return mockClientTranscriptScript.length;
}

export function getMockTranscriptLength(): number {
  return 1 + getMockClientTranscriptLength() * 2;
}

export function createMockClientTranscriptEvent(
  intake: IntakeForm,
  nextIndex: number,
  timestamp = new Date(),
): TranscriptEvent | undefined {
  const scriptLine = mockClientTranscriptScript[nextIndex];

  if (!scriptLine) {
    return undefined;
  }

  return createTranscriptEvent("client", scriptLine(intake), timestamp, `client-${nextIndex}`);
}

export function createAgentTranscriptEvent(text: string, timestamp = new Date()): TranscriptEvent {
  return createTranscriptEvent("agent", text, timestamp);
}

function createTranscriptEvent(
  speaker: TranscriptSpeaker,
  text: string,
  timestamp: Date,
  suffix = Math.random().toString(16).slice(2, 6),
): TranscriptEvent {
  return {
    id: `tr-${timestamp.getTime()}-${suffix}`,
    speaker,
    text,
    timestamp,
  };
}

export function createDemoSession(intake: IntakeForm): DemoSession {
  return {
    id: createSessionId(),
    status: "active",
    intake: { ...intake },
    startedAt: new Date(),
    transcript: [],
    triageSlots: createTriageSlotSnapshot(intake, []),
  };
}

export function endDemoSession(session: DemoSession): DemoSession {
  const endedAt = new Date();
  const triageSlots = createTriageSlotSnapshot(session.intake, session.transcript, endedAt);

  return {
    ...session,
    status: "ended",
    endedAt,
    triageSlots,
    structuredResult: createStructuredResult(session.intake, session.transcript, triageSlots),
  };
}

export function appendTranscriptEvent(session: DemoSession, event: TranscriptEvent): DemoSession {
  const transcript = [...session.transcript, event].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );

  return {
    ...session,
    transcript,
    triageSlots: createTriageSlotSnapshot(session.intake, transcript),
  };
}

export function formatDateTime(date?: Date): string {
  if (!date) {
    return "-";
  }

  return sessionDateFormatter.format(date);
}

export function formatTranscriptTime(date: Date): string {
  return transcriptTimeFormatter.format(date);
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function createSessionId(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
  ].join("");
  const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();

  return `CALL-${date}-${suffix}`;
}

function createStructuredResult(
  intake: IntakeForm,
  transcript: TranscriptEvent[],
  triageSlots: TriageSlotSnapshot,
): StructuredResult {
  const disputeAmount = getTriageSlotValue(triageSlots, "disputeAmount");
  const expectedContactTime = getTriageSlotValue(triageSlots, "expectedContactTime");
  const urgency = getTriageSlotValue(triageSlots, "urgency");

  return {
    triageSlots,
    clientProfile: {
      name: intake.clientName,
      phone: intake.phone,
      caseType: intake.caseType,
      city: intake.city,
      coreNeed: getTriageSlotValue(triageSlots, "coreNeed"),
      hasLawyer: normalizeHasLawyer(getTriageSlotValue(triageSlots, "hasLawyer")),
    },
    grading: {
      level: "中",
      reason: `已收集争议金额/标的：${disputeAmount}；紧急程度：${urgency}。分级规则将在后续切片细化。`,
    },
    appointment: {
      needed: "是",
      time: expectedContactTime,
      location: "线上或到所沟通",
    },
    risk: {
      level: "正常",
      note: "未触发敏感、无效或恶意咨询规则。",
    },
    transcript: {
      events: transcript,
      fullText: transcript.map(formatTranscriptLine).join("\n"),
      lineCount: transcript.length,
      summary:
        transcript.length > 0
          ? `已保留完整实时转写；槽位完成度 ${triageSlots.completedCount}/${triageSlots.totalCount}，缺失字段：${formatMissingTriageSlots(triageSlots)}。`
          : "本通演示未产生转写事件。",
    },
  };
}

function normalizeHasLawyer(value: string): StructuredResult["clientProfile"]["hasLawyer"] {
  if (value === "是" || value === "否") {
    return value;
  }

  return "未确认";
}

function formatTranscriptLine(event: TranscriptEvent): string {
  const speaker = event.speaker === "agent" ? "AI 分诊 Agent" : "当事人";

  return `[${formatTranscriptTime(event.timestamp)}] ${speaker}: ${event.text}`;
}
