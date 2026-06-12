import {
  createTriageSlotSnapshot,
  formatMissingTriageSlots,
  getTriageSlotValue,
} from "./triageSlots";
import { assessCase } from "./caseAssessment";
import { createDemoScenarioSnapshot, getDefaultDemoFixture } from "./demoFixtures";
import type {
  DemoScenarioSnapshot,
  DemoSession,
  IntakeForm,
  RecordingArchive,
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

const duplicateTranscriptWindowMs = 2_500;
const defaultScenario = createDemoScenarioSnapshot(getDefaultDemoFixture());

export function getMockClientTranscriptLength(session: DemoSession): number {
  return session.scenario.clientTranscript.length;
}

export function getMockTranscriptLength(scenario: DemoScenarioSnapshot = defaultScenario): number {
  return 1 + scenario.clientTranscript.length * 2;
}

export function createMockClientTranscriptEvent(
  session: DemoSession,
  nextIndex: number,
  timestamp = new Date(),
): TranscriptEvent | undefined {
  const scriptLine = session.scenario.clientTranscript[nextIndex];

  if (!scriptLine) {
    return undefined;
  }

  return createTranscriptEvent("client", scriptLine, timestamp, `client-${nextIndex}`);
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

export function createDemoSession(
  intake: IntakeForm,
  scenario: DemoScenarioSnapshot = defaultScenario,
): DemoSession {
  return {
    id: createSessionId(),
    status: "active",
    intake: { ...intake },
    scenario,
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
    structuredResult: createStructuredResult(session, triageSlots, endedAt),
  };
}

export function appendTranscriptEvent(session: DemoSession, event: TranscriptEvent): DemoSession {
  if (hasNearDuplicateTranscriptEvent(session.transcript, event)) {
    return session;
  }

  const transcript = [...session.transcript, event].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );

  return {
    ...session,
    transcript,
    triageSlots: createTriageSlotSnapshot(session.intake, transcript),
  };
}

function hasNearDuplicateTranscriptEvent(transcript: TranscriptEvent[], event: TranscriptEvent): boolean {
  const normalizedText = normalizeTranscriptText(event.text);
  const timestamp = event.timestamp.getTime();

  return transcript.some((existingEvent) => {
    if (existingEvent.speaker !== event.speaker || normalizeTranscriptText(existingEvent.text) !== normalizedText) {
      return false;
    }

    return Math.abs(existingEvent.timestamp.getTime() - timestamp) <= duplicateTranscriptWindowMs;
  });
}

function normalizeTranscriptText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
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
  session: DemoSession,
  triageSlots: TriageSlotSnapshot,
  endedAt: Date,
): StructuredResult {
  const intake = session.intake;
  const transcript = session.transcript;
  const expectedContactTime = getTriageSlotValue(triageSlots, "expectedContactTime");
  const assessment = assessCase(intake, transcript, triageSlots);

  return {
    triageSlots,
    sessionId: session.id,
    clientProfile: {
      name: intake.clientName,
      phone: intake.phone,
      caseType: intake.caseType,
      city: intake.city,
      coreNeed: getTriageSlotValue(triageSlots, "coreNeed"),
      hasLawyer: normalizeHasLawyer(getTriageSlotValue(triageSlots, "hasLawyer")),
    },
    grading: assessment.grading,
    appointment: {
      needed: "是",
      time: expectedContactTime,
      location: "线上或到所沟通",
    },
    risk: assessment.risk,
    transcript: {
      events: transcript,
      fullText: transcript.map(formatTranscriptLine).join("\n"),
      lineCount: transcript.length,
      summary:
        transcript.length > 0
          ? `已保留完整实时转写；槽位完成度 ${triageSlots.completedCount}/${triageSlots.totalCount}，缺失字段：${formatMissingTriageSlots(triageSlots)}。`
          : "本通演示未产生转写事件。",
    },
    recording: createRecordingArchive(session, endedAt),
  };
}

function createRecordingArchive(session: DemoSession, endedAt: Date): RecordingArchive {
  const durationSeconds = Math.max(1, getSecondsBetween(session.startedAt, endedAt));

  return {
    id: `REC-${session.id}`,
    sessionId: session.id,
    label: `${session.scenario.name} - 演示录音占位`,
    url: createSilentWavDataUrl(Math.min(durationSeconds, 3)),
    durationSeconds,
    createdAt: endedAt,
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

function getSecondsBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
}

function createSilentWavDataUrl(durationSeconds: number): string {
  const sampleRate = 8000;
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
