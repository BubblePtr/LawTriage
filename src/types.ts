export type CallStatus = "idle" | "active" | "ended";

export type IntakeForm = {
  phone: string;
  caseType: "婚姻家事";
  clientName: string;
  city: string;
};

export type CaseGrade = "大" | "中" | "小";

export type RiskLevel = "正常" | "敏感" | "无效" | "恶意";

export type TranscriptSpeaker = "client" | "agent";

export type TranscriptEvent = {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
  timestamp: Date;
};

export type StructuredResult = {
  clientProfile: {
    name: string;
    phone: string;
    caseType: string;
    city: string;
    coreNeed: string;
    hasLawyer: "否" | "是" | "未确认";
  };
  grading: {
    level: CaseGrade;
    reason: string;
  };
  appointment: {
    needed: "是" | "否";
    time: string;
    location: string;
  };
  risk: {
    level: RiskLevel;
    note: string;
  };
  transcript: {
    events: TranscriptEvent[];
    fullText: string;
    lineCount: number;
    summary: string;
  };
};

export type DemoSession = {
  id: string;
  status: Exclude<CallStatus, "idle">;
  intake: IntakeForm;
  startedAt: Date;
  transcript: TranscriptEvent[];
  endedAt?: Date;
  structuredResult?: StructuredResult;
};
