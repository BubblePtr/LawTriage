import { describe, expect, test } from "bun:test";
import { createAgentTranscriptEvent, createDemoSession } from "../src/demoSession";
import { getDefaultDemoFixture } from "../src/demoFixtures";
import { createAgentSpeechPlaybackPreparation } from "../src/agentSpeechSync";

describe("createAgentSpeechPlaybackPreparation", () => {
  test("adds the agent transcript and starts reveal progress before audio playback begins", () => {
    const session = createDemoSession(getDefaultDemoFixture().intake);
    const event = createAgentTranscriptEvent("您好，这里是华诚律师事务所。", new Date("2026-06-13T05:00:00.000Z"));

    const prepared = createAgentSpeechPlaybackPreparation(session, event);

    expect(prepared.session.transcript).toContainEqual(event);
    expect(prepared.playback).toEqual({
      durationMs: undefined,
      elapsedMs: 0,
      progress: 0,
      status: "playing",
    });
  });
});
