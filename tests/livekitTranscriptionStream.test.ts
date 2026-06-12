import { describe, expect, test } from "bun:test";
import {
  getLiveKitTextStreamSpeakerForTest,
  parseLiveKitTranscriptionStreamTextForTest,
  shouldAcceptLiveKitTranscriptionSpeakerForTest,
  shouldAcceptLiveKitTranscriptionTextStreamForTest,
  shouldEmitLiveKitTextStreamSegmentForTest,
} from "../src/mediaSession";

describe("LiveKit transcription text streams", () => {
  test("normalizes plain and JSON-line transcription payloads", () => {
    expect(parseLiveKitTranscriptionStreamTextForTest(" 您好  小华 ")).toBe("您好 小华");
    expect(parseLiveKitTranscriptionStreamTextForTest('{"text":"我想咨询离婚"}\n')).toBe("我想咨询离婚");
    expect(parseLiveKitTranscriptionStreamTextForTest('{"text":"我想"}\n{"text":"咨询离婚"}\n')).toBe(
      "我想咨询离婚",
    );
  });

  test("deduplicates final and non-final streams with the same segment id", () => {
    const seen = new Set<string>();

    expect(shouldEmitLiveKitTextStreamSegmentForTest(seen, "SG_demo")).toBe(true);
    expect(shouldEmitLiveKitTextStreamSegmentForTest(seen, "SG_demo")).toBe(false);
  });

  test("classifies local participant and local track transcriptions as client", () => {
    expect(getLiveKitTextStreamSpeakerForTest("browser-call", "browser-call")).toBe("client");
    expect(getLiveKitTextStreamSpeakerForTest("agent-job", "browser-call", true)).toBe("client");
    expect(getLiveKitTextStreamSpeakerForTest("agent-job", "browser-call", false)).toBe("agent");
  });

  test("accepts only client transcriptions from LiveKit built-in transcription channels", () => {
    expect(shouldAcceptLiveKitTranscriptionSpeakerForTest("client")).toBe(true);
    expect(shouldAcceptLiveKitTranscriptionSpeakerForTest("agent")).toBe(false);
  });

  test("does not consume LiveKit transcription text streams as UI transcript events", () => {
    expect(shouldAcceptLiveKitTranscriptionTextStreamForTest("client")).toBe(false);
    expect(shouldAcceptLiveKitTranscriptionTextStreamForTest("agent")).toBe(false);
  });
});
