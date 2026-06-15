import { describe, expect, test } from "bun:test";
import {
  createCompletedTranscriptPlayback,
  createTranscriptPlayback,
  splitTranscriptTextByProgress,
} from "../src/transcriptPlayback";

describe("transcript playback reveal", () => {
  test("splits text into spoken and pending ranges by playback progress", () => {
    expect(splitTranscriptTextByProgress("您好，小华正在记录。", 0.4)).toEqual({
      pendingText: "华正在记录。",
      spokenText: "您好，小",
    });
  });

  test("clamps playback state so a transcript line is revealed once, not duplicated", () => {
    const playing = createTranscriptPlayback({
      elapsedMs: 2400,
      progress: 1.4,
      text: "我先帮您做初步登记。",
    });
    const completed = createCompletedTranscriptPlayback(playing);

    expect(playing.progress).toBe(1);
    expect(completed).toEqual({
      durationMs: undefined,
      elapsedMs: 2400,
      progress: 1,
      status: "complete",
    });
  });
});
