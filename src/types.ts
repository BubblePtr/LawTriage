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

export type TriageSlotStatus = "collected" | "missing";

export type DemoScenarioSnapshot = {
  id: string;
  name: string;
  clientTranscript: string[];
};

export type TriageSlotKey =
  | "clientName"
  | "phone"
  | "caseType"
  | "city"
  | "disputeAmount"
  | "urgency"
  | "coreNeed"
  | "hasLawyer"
  | "expectedContactTime"
  | "transcript";

export type TranscriptEvent = {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
  timestamp: Date;
};

export type TriageSlot = {
  key: TriageSlotKey;
  label: string;
  status: TriageSlotStatus;
  value: string;
  evidence?: string;
};

export type TriageSlotSnapshot = {
  slots: TriageSlot[];
  missing: TriageSlot[];
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  updatedAt: Date;
};

export type RecordingArchive = {
  id: string;
  sessionId: string;
  label: string;
  url: string;
  durationSeconds: number;
  createdAt: Date;
};

export type StructuredResult = {
  triageSlots: TriageSlotSnapshot;
  sessionId: string;
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
  recording: RecordingArchive;
};

export type DemoSession = {
  id: string;
  status: Exclude<CallStatus, "idle">;
  intake: IntakeForm;
  scenario: DemoScenarioSnapshot;
  startedAt: Date;
  transcript: TranscriptEvent[];
  triageSlots: TriageSlotSnapshot;
  endedAt?: Date;
  structuredResult?: StructuredResult;
};
