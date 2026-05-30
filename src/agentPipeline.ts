import type { DemoSession, TranscriptEvent } from "./types";

export type AgentProviderKind = "dev" | "external";

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

export const legalReceptionSystemPrompt = [
  "你是华诚律师事务所的 AI 分诊接待助理小华，只处理婚姻家事初步接待。",
  "开场要说明身份和登记目的，不承诺具体法律结论。",
  "客户表达压力或担忧时先共情，再追问分诊所需事实。",
  "追问优先覆盖分居状态、子女抚养、共同房产、存款和财产转移风险。",
  "收尾时给出预约建议、材料准备方向，并说明律师助理会回访确认。",
].join("\n");

export function createDefaultAgentProviders(): AgentProviderBundle {
  return {
    asr: createDevAsrProvider(),
    label: "Dev Cascaded Agent",
    llm: createDevLlmProvider(),
    tts: createDevTtsProvider(),
  };
}

export function createInitialAgentState(providers: AgentProviderBundle): AgentRuntimeState {
  return {
    providerLabel: providers.label,
    status: "idle",
    detail: "Agent 已就绪，等待媒体文本事件。",
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
