import { describe, expect, test } from "bun:test";
import { appendTranscriptEvent } from "../src/demoSession";
import type { DemoSession, IntakeForm, TranscriptEvent } from "../src/types";

const intake: IntakeForm = {
  caseType: "婚姻家事",
  city: "上海市",
  clientName: "李女士",
  phone: "13800138000",
};

function createSession(): DemoSession {
  return {
    id: "CALL-TEST",
    intake,
    scenario: {
      id: "test",
      name: "test",
      clientTranscript: [],
    },
    startedAt: new Date("2026-06-12T14:37:00.000Z"),
    status: "active",
    transcript: [],
    triageSlots: {
      completedCount: 0,
      isComplete: false,
      missing: [],
      slots: [],
      totalCount: 0,
      updatedAt: new Date("2026-06-12T14:37:00.000Z"),
    },
  };
}

function event(id: string, text: string, timestamp: string): TranscriptEvent {
  return {
    id,
    speaker: "client",
    text,
    timestamp: new Date(timestamp),
  };
}

describe("appendTranscriptEvent", () => {
  test("drops near-duplicate LiveKit transcript events with different ids", () => {
    const withFirst = appendTranscriptEvent(
      createSession(),
      event("lk-stream-SG-one", "别打我。", "2026-06-12T14:37:53.000Z"),
    );
    const withDuplicate = appendTranscriptEvent(
      withFirst,
      event("lk-SG-two", " 别打我。 ", "2026-06-12T14:37:54.000Z"),
    );

    expect(withDuplicate.transcript).toHaveLength(1);
    expect(withDuplicate.transcript[0]?.id).toBe("lk-stream-SG-one");
  });

  test("keeps the same text when it appears after the duplicate window", () => {
    const withFirst = appendTranscriptEvent(
      createSession(),
      event("first", "别打我。", "2026-06-12T14:37:53.000Z"),
    );
    const withSecond = appendTranscriptEvent(
      withFirst,
      event("second", "别打我。", "2026-06-12T14:38:10.000Z"),
    );

    expect(withSecond.transcript).toHaveLength(2);
  });
});
