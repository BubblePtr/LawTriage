import { appendTranscriptEvent } from "./demoSession";
import { createTranscriptPlayback, type TranscriptPlaybackState } from "./transcriptPlayback";
import type { DemoSession, TranscriptEvent } from "./types";

export type AgentSpeechPlaybackPreparation = {
  playback: TranscriptPlaybackState;
  session: DemoSession;
};

export function createAgentSpeechPlaybackPreparation(
  session: DemoSession,
  event: TranscriptEvent,
): AgentSpeechPlaybackPreparation {
  return {
    playback: createTranscriptPlayback({
      elapsedMs: 0,
      progress: 0,
      text: event.text,
    }),
    session: appendTranscriptEvent(session, event),
  };
}
