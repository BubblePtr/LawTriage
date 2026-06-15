import type { SpeechPlaybackProgress } from "./agentPipeline";

export type TranscriptPlaybackStatus = "playing" | "complete";

export type TranscriptPlaybackState = {
  durationMs?: number;
  elapsedMs: number;
  progress: number;
  status: TranscriptPlaybackStatus;
};

export type TranscriptTextReveal = {
  pendingText: string;
  spokenText: string;
};

export function createTranscriptPlayback(progress: SpeechPlaybackProgress): TranscriptPlaybackState {
  return {
    durationMs: progress.durationMs,
    elapsedMs: progress.elapsedMs,
    progress: clampProgress(progress.progress),
    status: clampProgress(progress.progress) >= 1 ? "complete" : "playing",
  };
}

export function createCompletedTranscriptPlayback(state?: TranscriptPlaybackState): TranscriptPlaybackState {
  return {
    durationMs: state?.durationMs,
    elapsedMs: state?.durationMs ?? state?.elapsedMs ?? 0,
    progress: 1,
    status: "complete",
  };
}

export function splitTranscriptTextByProgress(text: string, progress: number): TranscriptTextReveal {
  const characters = Array.from(text);
  const spokenLength = Math.round(characters.length * clampProgress(progress));

  return {
    pendingText: characters.slice(spokenLength).join(""),
    spokenText: characters.slice(0, spokenLength).join(""),
  };
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(1, Math.max(0, progress));
}
