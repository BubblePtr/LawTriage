import { describe, expect, test } from "bun:test";
import { parseEnvFileText, resolveAgentProviderMode } from "../agent/agentRuntimeConfig";

describe("resolveAgentProviderMode", () => {
  test("prefers server-side AGENT_PROVIDER over VITE_AGENT_PROVIDER", () => {
    expect(
      resolveAgentProviderMode({
        AGENT_PROVIDER: "volcengine",
        VITE_AGENT_PROVIDER: "dev",
      }),
    ).toBe("volcengine");
  });

  test("reuses existing VITE_AGENT_PROVIDER for local LiveKit worker runs", () => {
    expect(resolveAgentProviderMode({ VITE_AGENT_PROVIDER: "volcengine" })).toBe("volcengine");
  });

  test("auto-selects volcengine when the local Volcengine chain is configured", () => {
    expect(
      resolveAgentProviderMode({
        ARK_API_KEY: "ark-key",
        VOLC_ASR_API_KEY: "asr-key",
        VOLC_TTS_API_KEY: "tts-key",
      }),
    ).toBe("volcengine");
  });
});

describe("parseEnvFileText", () => {
  test("parses simple and quoted values", () => {
    expect(
      parseEnvFileText(`
        # local secrets
        VITE_AGENT_PROVIDER=volcengine
        ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
        VOLC_TTS_VOICE_TYPE='voice id'
      `),
    ).toEqual({
      ARK_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
      VITE_AGENT_PROVIDER: "volcengine",
      VOLC_TTS_VOICE_TYPE: "voice id",
    });
  });
});
