import { describe, expect, test } from "bun:test";
import {
  createLiveKitAgentReplyTranscriptEventForTest,
  parseLiveKitAgentReplyStreamTextForTest,
  shouldEmitLiveKitAgentReplyForTest,
} from "../src/mediaSession";

describe("LiveKit agent reply text streams", () => {
  test("normalizes JSON payloads sent by the worker", () => {
    expect(
      parseLiveKitAgentReplyStreamTextForTest(
        JSON.stringify({
          id: "item_1",
          role: "assistant",
          text: " 您别害怕，我们会先了解情况。 ",
          timestamp: 1781275094903,
        }),
      ),
    ).toEqual({
      id: "item_1",
      text: "您别害怕，我们会先了解情况。",
      timestamp: 1781275094903,
    });
  });

  test("deduplicates worker reply streams by conversation item id", () => {
    const seen = new Set<string>();

    expect(shouldEmitLiveKitAgentReplyForTest(seen, "item_1")).toBe(true);
    expect(shouldEmitLiveKitAgentReplyForTest(seen, "item_1")).toBe(false);
  });

  test("uses browser receipt time for UI ordering", () => {
    const receivedAt = new Date("2026-06-12T15:51:24.661Z");

    expect(
      createLiveKitAgentReplyTranscriptEventForTest(
        {
          id: "item_1",
          text: "我特别理解您现在着手处理离婚相关事宜。",
          timestamp: Date.parse("2026-06-12T15:51:09.742Z"),
        },
        receivedAt,
      ),
    ).toEqual({
      id: "lk-agent-item_1",
      speaker: "agent",
      text: "我特别理解您现在着手处理离婚相关事宜。",
      timestamp: receivedAt,
    });
  });
});
