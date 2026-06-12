import { describe, expect, test } from "bun:test";
import { splitVolcTtsTextForTest } from "../agent/volcengineLiveKitProviders";

describe("Volcengine LiveKit TTS chunking", () => {
  test("splits long Chinese replies before sending them to non-streaming TTS", () => {
    const text =
      "我特别理解您现在着手处理离婚相关事宜肯定耗费了不少精力，接下来我和您确认几个关键的小细节，方便后续为您精准匹配擅长对应领域的婚姻家事律师：1. 您和丈夫目前的分居状态已经持续多长时间了呢？2. 您的儿子虽已成年但仍在读大学，目前你们双方有没有就孩子后续的教育、生活开支的分担问题沟通过相关想法？3. 这套价值两三百万的共同房产目前登记在谁的名下，是否还有未结清的房贷或者其他抵押类的债务呢？";

    const chunks = splitVolcTtsTextForTest(text, 80);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
    expect(chunks.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });
});
