import { describe, expect, test } from "bun:test";
import {
  createLiveKitAudioPlaybackStateForTest,
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
});
