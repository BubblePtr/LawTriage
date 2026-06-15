import { describe, expect, test } from "bun:test";
import {
  createLiveKitAudioPlaybackStateForTest,
  getLiveKitAudioPlaybackPipelineEventForTest,
  getLiveKitMicPublishOptionsForTest,
  isLiveKitMicAudioActiveForTest,
} from "../src/mediaSession";

describe("LiveKit microphone activity detection", () => {
  test("treats a flat PCM sample as silence", () => {
    expect(isLiveKitMicAudioActiveForTest(new Uint8Array([128, 128, 128, 128]))).toBe(false);
  });

  test("detects meaningful microphone movement", () => {
    expect(isLiveKitMicAudioActiveForTest(new Uint8Array([128, 160, 96, 150, 106, 128]))).toBe(true);
  });

  test("publishes microphone audio without RED or DTX for rtc-node agent compatibility", () => {
    expect(getLiveKitMicPublishOptionsForTest()).toMatchObject({
      dtx: false,
      red: false,
    });
  });

  test("reports blocked remote audio playback explicitly", () => {
    expect(createLiveKitAudioPlaybackStateForTest(false, new Error("NotAllowedError"))).toMatchObject({
      error: "NotAllowedError",
      mode: "livekit",
      status: "failed",
    });
    expect(createLiveKitAudioPlaybackStateForTest(true)).toMatchObject({
      mode: "livekit",
      status: "connected",
    });
  });

  test("does not advance playback pipeline on initial LiveKit playback false event", () => {
    expect(getLiveKitAudioPlaybackPipelineEventForTest(false, false)).toEqual({
      event: undefined,
      nextWasPlaying: false,
    });
    expect(getLiveKitAudioPlaybackPipelineEventForTest(true, false)).toEqual({
      event: {
        detail: "LiveKit Agent 远端音频正在播放。",
        stage: "playback",
        status: "active",
      },
      nextWasPlaying: true,
    });
    expect(getLiveKitAudioPlaybackPipelineEventForTest(false, true)).toEqual({
      event: {
        detail: "LiveKit Agent 远端音频播放完成。",
        stage: "playback",
        status: "done",
      },
      nextWasPlaying: false,
    });
  });
});
