import type { DemoSession, TranscriptEvent } from "./types";
import { legalReceptionSystemPrompt } from "./agentPrompt";

export type AgentProviderKind = "dev" | "openai" | "volcengine";

export type AgentRuntimeStatus = "idle" | "listening" | "thinking" | "speaking" | "failed";

export type AgentRuntimeState = {
  providerLabel: string;
  status: AgentRuntimeStatus;
  detail: string;
  error?: string;
  lastReplyAt?: Date;
};

export type AgentReplyRequest = {
  clientEvent?: TranscriptEvent;
  session: DemoSession;
  transcript: TranscriptEvent[];
  turnIndex: number;
};

export type AsrProvider = {
  kind: AgentProviderKind;
  label: string;
  acceptTextEvent: (event: TranscriptEvent) => Promise<TranscriptEvent>;
};

export type LlmProvider = {
  kind: AgentProviderKind;
  label: string;
  systemPrompt: string;
  generateReply: (request: AgentReplyRequest) => Promise<string>;
};

export type TtsProvider = {
  kind: AgentProviderKind;
  label: string;
  synthesize: (text: string) => Promise<void>;
};

export type AgentProviderBundle = {
  asr: AsrProvider;
  label: string;
  llm: LlmProvider;
  tts: TtsProvider;
};

export function createDefaultAgentProviders(): AgentProviderBundle {
  if (getAgentProviderMode() === "volcengine") {
    return {
      asr: createVolcengineAsrProvider(),
      label: "Volcengine Cascaded Agent",
      llm: createVolcengineLlmProvider(),
      tts: createVolcengineTtsProvider(),
    };
  }

  if (getAgentProviderMode() === "openai") {
    return {
      asr: createOpenAiAsrProvider(),
      label: "OpenAI Cascaded Agent",
      llm: createOpenAiLlmProvider(),
      tts: createOpenAiTtsProvider(),
    };
  }

  return {
    asr: createDevAsrProvider(),
    label: "Dev Cascaded Agent",
    llm: createDevLlmProvider(),
    tts: createDevTtsProvider(),
  };
}

export function getAgentProviderMode(): AgentProviderKind {
  if (import.meta.env.VITE_AGENT_PROVIDER === "volcengine") {
    return "volcengine";
  }

  return import.meta.env.VITE_AGENT_PROVIDER === "openai" ? "openai" : "dev";
}

export function createInitialAgentState(providers: AgentProviderBundle): AgentRuntimeState {
  return {
    providerLabel: providers.label,
    status: "idle",
    detail: "Agent 已就绪，等待媒体文本事件。",
  };
}

function createOpenAiAsrProvider(): AsrProvider {
  return {
    kind: "openai",
    label: "OpenAI Audio Transcription",
    async acceptTextEvent(event) {
      return event;
    },
  };
}

function createOpenAiLlmProvider(): LlmProvider {
  return {
    kind: "openai",
    label: "OpenAI Responses",
    systemPrompt: legalReceptionSystemPrompt,
    async generateReply(request) {
      const response = await postJson<{ text: string }>("/api/agent/reply", {
        clientEvent: serializeTranscriptEvent(request.clientEvent),
        session: {
          id: request.session.id,
          intake: request.session.intake,
          startedAt: request.session.startedAt.toISOString(),
        },
        systemPrompt: legalReceptionSystemPrompt,
        transcript: request.transcript.map(serializeTranscriptEvent),
        turnIndex: request.turnIndex,
      });

      return response.text;
    },
  };
}

function createOpenAiTtsProvider(): TtsProvider {
  return {
    kind: "openai",
    label: "OpenAI Speech",
    async synthesize(text) {
      const response = await fetch("/api/agent/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "OpenAI TTS 请求失败。"));
      }

      await playSpeechBlob(await response.blob());
    },
  };
}

function createVolcengineAsrProvider(): AsrProvider {
  return {
    kind: "volcengine",
    label: "Volcengine Seed ASR",
    async acceptTextEvent(event) {
      return event;
    },
  };
}

function createVolcengineLlmProvider(): LlmProvider {
  return {
    kind: "volcengine",
    label: "Volcengine Ark",
    systemPrompt: legalReceptionSystemPrompt,
    async generateReply(request) {
      const response = await postJson<{ text: string }>("/api/agent/reply", {
        clientEvent: serializeTranscriptEvent(request.clientEvent),
        session: {
          id: request.session.id,
          intake: request.session.intake,
          startedAt: request.session.startedAt.toISOString(),
        },
        systemPrompt: legalReceptionSystemPrompt,
        transcript: request.transcript.map(serializeTranscriptEvent),
        turnIndex: request.turnIndex,
      });

      return response.text;
    },
  };
}

function createVolcengineTtsProvider(): TtsProvider {
  return {
    kind: "volcengine",
    label: "Volcengine Seed TTS",
    async synthesize(text) {
      const response = await fetch("/api/agent/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "火山 TTS 请求失败。"));
      }

      await playSpeechBlob(await response.blob());
    },
  };
}

function createDevAsrProvider(): AsrProvider {
  return {
    kind: "dev",
    label: "Dev Text ASR",
    async acceptTextEvent(event) {
      return event;
    },
  };
}

function serializeTranscriptEvent(event?: TranscriptEvent) {
  if (!event) {
    return undefined;
  }

  return {
    id: event.id,
    speaker: event.speaker,
    text: event.text,
    timestamp: event.timestamp.toISOString(),
  };
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Agent provider 请求失败。"));
  }

  return response.json() as Promise<T>;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };

    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function playSpeechBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  window.dispatchEvent(new Event("lawtriage:tts-start"));

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
      };

      const finish = () => {
        cleanup();
        resolve();
      };
      const fail = (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error("TTS 音频播放失败。"));
      };

      audio.onended = finish;
      audio.onerror = () => fail(new Error(getAudioPlaybackErrorMessage(audio.error)));
      const playPromise = audio.play();

      if (playPromise) {
        playPromise.catch(fail);
      }
    });
  } finally {
    window.dispatchEvent(new Event("lawtriage:tts-end"));
    URL.revokeObjectURL(url);
  }
}

function getAudioPlaybackErrorMessage(error: MediaError | null): string {
  if (!error) {
    return "TTS 音频播放失败。";
  }

  return error.message || `TTS 音频播放失败，错误码：${error.code}。`;
}

function createDevLlmProvider(): LlmProvider {
  return {
    kind: "dev",
    label: "Dev Rule LLM",
    systemPrompt: legalReceptionSystemPrompt,
    async generateReply(request) {
      const clientName = request.session.intake.clientName;
      const city = request.session.intake.city;

      if (!request.clientEvent) {
        return `您好，这里是华诚律师事务所，我是 AI 分诊助理小华。我先帮${clientName}做一个婚姻家事初步登记，方便律师后续判断是否适合预约。`;
      }

      if (request.turnIndex === 1) {
        return `${clientName}，我理解。离婚和财产分割会同时影响家庭安排和资产安全。我先确认几个关键点：目前双方是否已经分居，是否涉及孩子抚养或共同房产？`;
      }

      if (request.turnIndex === 2) {
        return "明白，这里有子女抚养、共同房产和财产线索三个重点。为了判断案件紧急程度，您大概估计争议财产金额在什么范围？有没有银行流水、房产证或对方转账记录？";
      }

      if (request.turnIndex === 3) {
        return `好的，按您描述的金额和转移存款担忧，建议尽快预约${city}婚姻家事律师详细评估。您先保留房产、存款、聊天记录和转账线索，律师会进一步判断是否需要做财产保全。`;
      }

      return "已记录。稍后律师助理会根据您留下的电话确认明天下午的具体沟通时间，并同步材料清单。本次初步登记先到这里。";
    },
  };
}

function createDevTtsProvider(): TtsProvider {
  return {
    kind: "dev",
    label: "Dev Text TTS",
    async synthesize() {
      return undefined;
    },
  };
}
