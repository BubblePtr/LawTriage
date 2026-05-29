import type { DemoSession, IntakeForm, StructuredResult, TranscriptEvent, TranscriptSpeaker } from "./types";

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

const mockTranscriptScript: Array<{
  speaker: TranscriptSpeaker;
  text: (intake: IntakeForm) => string;
}> = [
  {
    speaker: "agent",
    text: () => "您好，这里是华诚律师事务所，我先帮您做一个初步登记，方便律师后续判断是否适合预约。",
  },
  {
    speaker: "client",
    text: (intake) => `你好，我是${intake.clientName}，人在${intake.city}，想咨询离婚和财产分割的问题。`,
  },
  {
    speaker: "agent",
    text: () => "我理解。为了先判断案件紧急程度，我想确认一下：目前双方是否已经分居，是否涉及孩子抚养或共同房产？",
  },
  {
    speaker: "client",
    text: () => "已经分居三个月，有一套共同房产，还有一个孩子，主要担心对方转移存款。",
  },
  {
    speaker: "agent",
    text: () => "明白，这里有财产线索和子女抚养两个重点。我再确认一下，您大概估计争议财产金额在什么范围？",
  },
  {
    speaker: "client",
    text: () => "房子大概四百万，还有几十万存款。我想尽快跟律师聊一下。",
  },
  {
    speaker: "agent",
    text: () => "好的，您的情况建议尽快预约婚姻家事律师做详细评估，尤其要先固定财产线索和沟通孩子抚养安排。",
  },
  {
    speaker: "client",
    text: () => "可以，那帮我安排明天下午沟通吧。",
  },
  {
    speaker: "agent",
    text: () => "已记录。稍后律师助理会根据您留下的电话确认具体时间和材料清单，本次初步登记先到这里。",
  },
];

export function createDemoSession(intake: IntakeForm): DemoSession {
  return {
    id: createSessionId(),
    status: "active",
    intake: { ...intake },
    startedAt: new Date(),
    transcript: [],
  };
}

export function endDemoSession(session: DemoSession): DemoSession {
  const endedAt = new Date();

  return {
    ...session,
    status: "ended",
    endedAt,
    structuredResult: createStructuredResult(session.intake, session.transcript),
  };
}

export function appendTranscriptEvent(session: DemoSession, event: TranscriptEvent): DemoSession {
  const transcript = [...session.transcript, event].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );

  return {
    ...session,
    transcript,
  };
}

export function createMockTranscriptEvent(
  intake: IntakeForm,
  nextIndex: number,
  timestamp = new Date(),
): TranscriptEvent | undefined {
  const scriptLine = mockTranscriptScript[nextIndex];

  if (!scriptLine) {
    return undefined;
  }

  return {
    id: `tr-${timestamp.getTime()}-${nextIndex}`,
    speaker: scriptLine.speaker,
    text: scriptLine.text(intake),
    timestamp,
  };
}

export function getMockTranscriptLength(): number {
  return mockTranscriptScript.length;
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

function createStructuredResult(intake: IntakeForm, transcript: TranscriptEvent[]): StructuredResult {
  return {
    clientProfile: {
      name: intake.clientName,
      phone: intake.phone,
      caseType: intake.caseType,
      city: intake.city,
      coreNeed: "婚姻家事初步咨询，需进一步确认财产线索与沟通时间。",
      hasLawyer: "未确认",
    },
    grading: {
      level: "中",
      reason: "演示占位：案件类型明确，信息已留存，标的额和紧急程度待后续分诊槽位补全。",
    },
    appointment: {
      needed: "是",
      time: "待律师助理回访确认",
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
          ? "已保留本通演示的完整实时转写，可供后续分诊槽位和录音回放切片复用。"
          : "本通演示未产生转写事件。",
    },
  };
}

function formatTranscriptLine(event: TranscriptEvent): string {
  const speaker = event.speaker === "agent" ? "AI 分诊 Agent" : "当事人";

  return `[${formatTranscriptTime(event.timestamp)}] ${speaker}: ${event.text}`;
}
