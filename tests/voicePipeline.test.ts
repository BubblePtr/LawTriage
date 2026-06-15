import { describe, expect, test } from "bun:test";
import {
  createCompactVoicePipelineView,
  createInitialVoicePipelineSnapshot,
  reduceVoicePipelineSnapshot,
} from "../src/voicePipeline";

describe("voice pipeline state", () => {
  test("advances ordered stages and records the active detail", () => {
    const startedAt = new Date("2026-06-13T05:00:00.000Z");
    const next = reduceVoicePipelineSnapshot(createInitialVoicePipelineSnapshot(startedAt), {
      at: new Date("2026-06-13T05:00:01.250Z"),
      detail: "火山 ASR relay 已就绪。",
      stage: "asr",
      status: "active",
    });

    expect(next.currentStageId).toBe("asr");
    expect(next.stages.find((stage) => stage.id === "media")?.status).toBe("done");
    expect(next.stages.find((stage) => stage.id === "microphone")?.status).toBe("done");
    expect(next.stages.find((stage) => stage.id === "asr")).toMatchObject({
      detail: "火山 ASR relay 已就绪。",
      elapsedMs: 1250,
      status: "active",
    });
  });

  test("keeps failed stage evidence until reset", () => {
    const failed = reduceVoicePipelineSnapshot(createInitialVoicePipelineSnapshot(), {
      detail: "浏览器阻止了远端音频播放。",
      error: "NotAllowedError",
      stage: "playback",
      status: "failed",
    });

    expect(failed.currentStageId).toBe("playback");
    expect(failed.stages.find((stage) => stage.id === "playback")).toMatchObject({
      detail: "浏览器阻止了远端音频播放。",
      error: "NotAllowedError",
      status: "failed",
    });

    const reset = reduceVoicePipelineSnapshot(failed, {
      stage: "media",
      status: "reset",
    });

    expect(reset.currentStageId).toBe("media");
    expect(reset.stages.every((stage) => stage.status === "idle")).toBe(true);
  });

  test("keeps playback active while transcript writeback is active", () => {
    const playback = reduceVoicePipelineSnapshot(createInitialVoicePipelineSnapshot(), {
      detail: "Agent 语音正在播放。",
      stage: "playback",
      status: "active",
    });
    const transcript = reduceVoicePipelineSnapshot(playback, {
      detail: "Agent 回复字幕同步显示中。",
      stage: "transcript",
      status: "active",
    });

    expect(transcript.stages.find((stage) => stage.id === "playback")?.status).toBe("active");
    expect(transcript.stages.find((stage) => stage.id === "transcript")?.status).toBe("active");
  });

  test("builds a compact view from major stages without completed one-time setup stages", () => {
    const startedAt = new Date("2026-06-13T05:00:00.000Z");
    const media = reduceVoicePipelineSnapshot(createInitialVoicePipelineSnapshot(startedAt), {
      at: new Date("2026-06-13T05:00:00.100Z"),
      detail: "LiveKit room 已连接。",
      stage: "media",
      status: "done",
    });
    const microphone = reduceVoicePipelineSnapshot(media, {
      at: new Date("2026-06-13T05:00:00.200Z"),
      detail: "LiveKit 麦克风音轨已发布。",
      stage: "microphone",
      status: "done",
    });
    const asr = reduceVoicePipelineSnapshot(microphone, {
      at: new Date("2026-06-13T05:00:01.250Z"),
      detail: "火山 ASR relay 已就绪。",
      stage: "asr",
      status: "active",
    });

    const view = createCompactVoicePipelineView(asr);

    expect(view.currentStage.id).toBe("asr");
    expect(view.stages.map((stage) => stage.id)).toEqual(["speech", "asr", "llm", "tts", "playback", "transcript"]);
    expect(view.stageStatusText).toBe("客户语音已完成 / ASR进行中 / LLM待开始 / TTS待开始 / 播放待开始 / 字幕写回待开始");
  });
});
