export type VoicePipelineStageId =
  | "media"
  | "microphone"
  | "speech"
  | "asr"
  | "llm"
  | "tts"
  | "playback"
  | "transcript";

export type VoicePipelineStageStatus = "idle" | "pending" | "active" | "done" | "failed";

export type VoicePipelineEventStatus = VoicePipelineStageStatus | "reset";

export type VoicePipelineEvent = {
  at?: Date;
  detail?: string;
  error?: string;
  stage: VoicePipelineStageId;
  status: VoicePipelineEventStatus;
};

export type VoicePipelineStage = {
  detail: string;
  elapsedMs?: number;
  error?: string;
  id: VoicePipelineStageId;
  label: string;
  status: VoicePipelineStageStatus;
  updatedAt?: Date;
};

export type VoicePipelineSnapshot = {
  currentStageId: VoicePipelineStageId;
  startedAt: Date;
  stages: VoicePipelineStage[];
};

export type CompactVoicePipelineView = {
  currentStage: VoicePipelineStage;
  stages: VoicePipelineStage[];
  stageStatusText: string;
};

const voicePipelineStageLabels: Record<VoicePipelineStageId, string> = {
  asr: "ASR",
  llm: "LLM",
  media: "媒体接入",
  microphone: "麦克风",
  playback: "播放",
  speech: "客户语音",
  transcript: "字幕写回",
  tts: "TTS",
};

export const voicePipelineStageOrder: VoicePipelineStageId[] = [
  "media",
  "microphone",
  "speech",
  "asr",
  "llm",
  "tts",
  "playback",
  "transcript",
];

export const voicePipelineMajorStageOrder: VoicePipelineStageId[] = [
  "speech",
  "asr",
  "llm",
  "tts",
  "playback",
  "transcript",
];

const voicePipelineOneTimeStageIds = new Set<VoicePipelineStageId>(["media", "microphone"]);

const voicePipelineStageStatusLabels: Record<VoicePipelineStageStatus, string> = {
  active: "进行中",
  done: "已完成",
  failed: "异常",
  idle: "待开始",
  pending: "等待中",
};

export function createInitialVoicePipelineSnapshot(startedAt = new Date()): VoicePipelineSnapshot {
  return {
    currentStageId: "media",
    startedAt,
    stages: voicePipelineStageOrder.map((id) => ({
      detail: "等待开始",
      id,
      label: voicePipelineStageLabels[id],
      status: "idle",
    })),
  };
}

export function createCompactVoicePipelineView(snapshot: VoicePipelineSnapshot): CompactVoicePipelineView {
  const stages = voicePipelineMajorStageOrder
    .map((id) => snapshot.stages.find((stage) => stage.id === id))
    .filter((stage): stage is VoicePipelineStage => Boolean(stage));
  const currentStage = getCompactCurrentVoicePipelineStage(snapshot, stages);

  return {
    currentStage,
    stages,
    stageStatusText: stages
      .map((stage) => `${stage.label}${getVoicePipelineStageStatusLabel(stage.status)}`)
      .join(" / "),
  };
}

export function getVoicePipelineStageStatusLabel(status: VoicePipelineStageStatus): string {
  return voicePipelineStageStatusLabels[status];
}

export function reduceVoicePipelineSnapshot(
  snapshot: VoicePipelineSnapshot,
  event: VoicePipelineEvent,
): VoicePipelineSnapshot {
  if (event.status === "reset") {
    return createInitialVoicePipelineSnapshot(event.at ?? new Date());
  }

  const eventStageIndex = voicePipelineStageOrder.indexOf(event.stage);
  const updatedAt = event.at ?? new Date();
  const elapsedMs = Math.max(0, updatedAt.getTime() - snapshot.startedAt.getTime());
  const nextStatus: VoicePipelineStageStatus = event.status;

  return {
    ...snapshot,
    currentStageId: event.stage,
    stages: snapshot.stages.map((stage, stageIndex) => {
      if (stage.id === event.stage) {
        return {
          ...stage,
          detail: event.detail ?? stage.detail,
          elapsedMs,
          error: event.error,
          status: nextStatus,
          updatedAt,
        };
      }

      if (
        nextStatus !== "failed" &&
        stage.status !== "failed" &&
        stageIndex < eventStageIndex &&
        shouldAutoCompleteStage(stage, event.stage, nextStatus)
      ) {
        return {
          ...stage,
          status: stage.status === "idle" || stage.status === "pending" || stage.status === "active" ? "done" : stage.status,
        };
      }

      return stage;
    }),
  };
}

function getCompactCurrentVoicePipelineStage(
  snapshot: VoicePipelineSnapshot,
  majorStages: VoicePipelineStage[],
): VoicePipelineStage {
  const currentStage = snapshot.stages.find((stage) => stage.id === snapshot.currentStageId) ?? snapshot.stages[0];

  if (!currentStage || !shouldHideOneTimeStageAsCurrent(currentStage)) {
    return currentStage;
  }

  const activeMajorStage = findLastVoicePipelineStage(
    majorStages,
    (stage) => stage.status === "active" || stage.status === "pending" || stage.status === "failed",
  );
  if (activeMajorStage) {
    return activeMajorStage;
  }

  return findLastVoicePipelineStage(majorStages, (stage) => stage.status !== "idle") ?? currentStage;
}

function shouldHideOneTimeStageAsCurrent(stage: VoicePipelineStage): boolean {
  return voicePipelineOneTimeStageIds.has(stage.id) && stage.status === "done";
}

function findLastVoicePipelineStage(
  stages: readonly VoicePipelineStage[],
  predicate: (stage: VoicePipelineStage) => boolean,
): VoicePipelineStage | undefined {
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    const stage = stages[index];
    if (stage && predicate(stage)) {
      return stage;
    }
  }

  return undefined;
}

function shouldAutoCompleteStage(
  stage: VoicePipelineStage,
  eventStageId: VoicePipelineStageId,
  eventStatus: VoicePipelineStageStatus,
): boolean {
  return !(eventStageId === "transcript" && eventStatus === "active" && stage.id === "playback" && stage.status === "active");
}
