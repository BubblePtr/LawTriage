import { describe, expect, test } from "bun:test";
import { resolveInitialMediaModeForTest } from "../src/mediaSession";

describe("initial media config", () => {
  test("prefers LiveKit when a real agent provider and LiveKit URL are configured", () => {
    expect(resolveInitialMediaModeForTest("volcengine", "wss://lawtriage.livekit.cloud")).toBe("livekit");
    expect(resolveInitialMediaModeForTest("openai", "wss://lawtriage.livekit.cloud")).toBe("livekit");
  });

  test("falls back to browser microphone for real providers without LiveKit defaults", () => {
    expect(resolveInitialMediaModeForTest("volcengine", "")).toBe("browser");
  });

  test("keeps the dev mock default unless LiveKit is explicitly configured", () => {
    expect(resolveInitialMediaModeForTest("dev", "")).toBe("mock");
    expect(resolveInitialMediaModeForTest("dev", "wss://lawtriage.livekit.cloud")).toBe("livekit");
  });
});
