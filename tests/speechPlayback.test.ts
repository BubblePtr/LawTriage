import { describe, expect, test } from "bun:test";
import { playSpeechBlobForTest, type SpeechPlaybackCallbacks } from "../src/agentPipeline";

type ListenerName = "ended" | "error" | "loadedmetadata" | "timeupdate";

class FakeAudioElement {
  currentTime = 0;
  duration = 2;
  error: MediaError | null = null;
  private listeners = new Map<ListenerName, Array<() => void>>();

  addEventListener(name: ListenerName, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  removeEventListener(name: ListenerName, listener: () => void) {
    this.listeners.set(
      name,
      (this.listeners.get(name) ?? []).filter((candidate) => candidate !== listener),
    );
  }

  play() {
    this.emit("loadedmetadata");
    this.currentTime = 1;
    this.emit("timeupdate");
    this.currentTime = 2;
    this.emit("ended");
    return Promise.resolve();
  }

  emit(name: ListenerName) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener();
    }
  }
}

class SlowlyTickingAudioElement extends FakeAudioElement {
  private startedAt = 0;

  override play() {
    this.startedAt = Date.now();
    this.emit("loadedmetadata");

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        this.currentTime = this.duration;
        this.emit("ended");
        resolve();
      }, this.duration * 1000);
    });
  }
}

describe("speech playback progress", () => {
  test("emits start, progress, and end from audio playback events", async () => {
    const audio = new FakeAudioElement();
    const events: string[] = [];
    const progressValues: number[] = [];
    const callbacks: SpeechPlaybackCallbacks = {
      onPlaybackEnd: () => events.push("end"),
      onPlaybackStart: () => events.push("start"),
      onProgress: (progress) => progressValues.push(progress.progress),
    };

    await playSpeechBlobForTest(new Blob(["demo"]), "您好，这里是小华。", callbacks, {
      createAudioElement: () => audio as unknown as HTMLAudioElement,
      createObjectUrl: () => "blob:test",
      dispatchWindowEvent: () => undefined,
      revokeObjectUrl: () => undefined,
    });

    expect(events).toEqual(["start", "end"]);
    expect(progressValues).toContain(0);
    expect(progressValues).toContain(0.5);
    expect(progressValues.at(-1)).toBe(1);
  });

  test("falls back to text-paced animation when audio duration is unavailable", async () => {
    const audio = new FakeAudioElement();
    audio.duration = Number.NaN;
    const progressValues: number[] = [];

    await playSpeechBlobForTest(
      new Blob(["demo"]),
      "这是一段没有 duration metadata 的语音。",
      {
        onProgress: (progress) => progressValues.push(progress.progress),
      },
      {
        clearProgressTimer: (timer) => clearInterval(timer),
        createAudioElement: () => audio as unknown as HTMLAudioElement,
        createObjectUrl: () => "blob:test",
        dispatchWindowEvent: () => undefined,
        now: () => Date.now(),
        revokeObjectUrl: () => undefined,
        setProgressTimer: (callback, intervalMs) => setInterval(callback, intervalMs) as unknown as number,
      },
    );

    expect(progressValues[0]).toBe(0);
    expect(progressValues.some((value) => value > 0 && value < 1)).toBe(true);
    expect(progressValues.at(-1)).toBe(1);
  });

  test("keeps progress moving even when the audio element does not emit timeupdate during playback", async () => {
    const audio = new SlowlyTickingAudioElement();
    audio.duration = 0.16;
    const progressValues: number[] = [];

    await playSpeechBlobForTest(
      new Blob(["demo"]),
      "您好，这里是小华。",
      {
        onProgress: (progress) => progressValues.push(progress.progress),
      },
      {
        clearProgressTimer: (timer) => clearInterval(timer),
        createAudioElement: () => audio as unknown as HTMLAudioElement,
        createObjectUrl: () => "blob:test",
        dispatchWindowEvent: () => undefined,
        now: () => Date.now(),
        revokeObjectUrl: () => undefined,
        setProgressTimer: (callback, intervalMs) => setInterval(callback, intervalMs) as unknown as number,
      },
    );

    expect(progressValues.some((value) => value > 0 && value < 1)).toBe(true);
    expect(progressValues.at(-1)).toBe(1);
  });
});
