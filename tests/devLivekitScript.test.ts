import { describe, expect, test } from "bun:test";
import { createDevLiveKitProcessSpecs, getChildExitCode } from "../scripts/devLivekit";

describe("createDevLiveKitProcessSpecs", () => {
  test("starts the Vite web server and LiveKit agent worker", () => {
    expect(createDevLiveKitProcessSpecs()).toEqual([
      {
        name: "web",
        command: "bun",
        args: ["run", "dev"],
      },
      {
        name: "agent",
        command: "bun",
        args: ["run", "agent:dev"],
      },
    ]);
  });

  test("passes extra args only to the Vite dev server", () => {
    expect(createDevLiveKitProcessSpecs(["--host", "127.0.0.1", "--port", "5174"])).toEqual([
      {
        name: "web",
        command: "bun",
        args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5174"],
      },
      {
        name: "agent",
        command: "bun",
        args: ["run", "agent:dev"],
      },
    ]);
  });
});

describe("getChildExitCode", () => {
  test("keeps successful exit codes successful", () => {
    expect(getChildExitCode(0, null)).toBe(0);
  });

  test("treats signaled exits as failures", () => {
    expect(getChildExitCode(null, "SIGTERM")).toBe(1);
  });
});
