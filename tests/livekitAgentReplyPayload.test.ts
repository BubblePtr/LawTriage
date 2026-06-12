import { describe, expect, test } from "bun:test";
import { createAgentReplyStreamPayload } from "../agent/livekitAgentReply";

describe("createAgentReplyStreamPayload", () => {
  test("serializes assistant conversation items", () => {
    expect(
      createAgentReplyStreamPayload({
        createdAt: 1781275094903,
        id: "item_1",
        role: "assistant",
        textContent: " 您别害怕。 ",
        type: "message",
      }),
    ).toEqual({
      id: "item_1",
      role: "assistant",
      text: "您别害怕。",
      timestamp: 1781275094903,
    });
  });

  test("ignores non-assistant or empty items", () => {
    expect(
      createAgentReplyStreamPayload({
        createdAt: 1,
        id: "item_user",
        role: "user",
        textContent: "别打我。",
        type: "message",
      }),
    ).toBeUndefined();
    expect(
      createAgentReplyStreamPayload({
        createdAt: 2,
        id: "item_empty",
        role: "assistant",
        textContent: " ",
        type: "message",
      }),
    ).toBeUndefined();
  });
});
