import { describe, expect, test } from "bun:test";
import { legalReceptionSystemPrompt } from "../src/agentPrompt";

describe("legal reception prompt", () => {
  test("keeps LiveKit voice replies short and turn-based", () => {
    expect(legalReceptionSystemPrompt).toContain("每轮回复控制在 80 字以内");
    expect(legalReceptionSystemPrompt).toContain("每轮只问一个主要问题");
    expect(legalReceptionSystemPrompt).toContain("不要使用编号清单");
  });
});
