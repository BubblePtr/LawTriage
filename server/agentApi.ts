import type { Connect, Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import WebSocket, { type RawData, WebSocketServer } from "ws";

type AgentProviderMode = "dev" | "openai" | "volcengine";
type UpgradeCapableServer = {
  on(event: "upgrade", listener: (req: IncomingMessage, socket: Socket, head: Buffer) => void): unknown;
};

type AgentApiEnv = {
  ARK_API_KEY?: string;
  ARK_BASE_URL?: string;
  ARK_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_ASR_MODEL?: string;
  OPENAI_LLM_MODEL?: string;
  OPENAI_TTS_MODEL?: string;
  OPENAI_TTS_VOICE?: string;
  VITE_AGENT_PROVIDER?: string;
  VOLC_ASR_API_KEY?: string;
  VOLC_ASR_RESOURCE_ID?: string;
  VOLC_ASR_STREAM_WS_URL?: string;
  VOLC_TTS_API_KEY?: string;
  VOLC_TTS_RESOURCE_ID?: string;
  VOLC_TTS_URL?: string;
  VOLC_TTS_VOICE_TYPE?: string;
};

const defaultArkBaseUrl = "https://ark.cn-beijing.volces.com/api/v3";
const defaultOpenAiAsrModel = "gpt-4o-mini-transcribe";
const defaultOpenAiLlmModel = "gpt-4.1-mini";
const defaultOpenAiTtsModel = "gpt-4o-mini-tts";
const defaultOpenAiTtsVoice = "coral";
const defaultVolcAsrResourceId = "volc.seedasr.sauc.duration";
const defaultVolcAsrStreamWsUrl = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const defaultVolcTtsResourceId = "seed-tts-2.0";
const defaultVolcTtsUrl = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const maxRequestBodyBytes = 16 * 1024 * 1024;
const upstreamTimeoutMs = 45_000;

class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`请求体超过 ${formatBytes(limitBytes)} 上限。`);
  }
}

export function agentApiPlugin(env: AgentApiEnv): Plugin {
  return {
    name: "lawtriage-agent-api",
    configureServer(server) {
      installAgentApiMiddleware(server.middlewares, env);
      installAgentAsrWebSocket(server.httpServer, env);
    },
    configurePreviewServer(server) {
      installAgentApiMiddleware(server.middlewares, env);
      installAgentAsrWebSocket(server.httpServer, env);
    },
  };
}

function installAgentApiMiddleware(middlewares: Connect.Server, env: AgentApiEnv) {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/agent/")) {
      next();
      return;
    }

    try {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "只支持 POST 请求。" });
        return;
      }

      if (req.url.startsWith("/api/agent/reply")) {
        await handleReply(req, res, env);
        return;
      }

      if (req.url.startsWith("/api/agent/speech")) {
        await handleSpeech(req, res, env);
        return;
      }

      if (req.url.startsWith("/api/agent/transcribe")) {
        await handleTranscribe(req, res, env);
        return;
      }

      sendJson(res, 404, { error: "未知 Agent API。" });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        res.setHeader("Connection", "close");
        sendJson(res, 413, { error: error.message });
        return;
      }

      sendJson(res, 500, { error: getErrorMessage(error) });
    }
  });
}

function installAgentAsrWebSocket(httpServer: UpgradeCapableServer | null, env: AgentApiEnv) {
  if (!httpServer) {
    return;
  }

  const wsServer = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";

    if (pathname !== "/api/agent/asr") {
      return;
    }

    if (getProviderMode(env) !== "volcengine") {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(req, socket, head, (client) => {
      wsServer.emit("connection", client, req);
    });
  });

  wsServer.on("connection", (client) => {
    connectVolcAsrRelay(client, env);
  });
}

async function handleReply(req: IncomingMessage, res: ServerResponse, env: AgentApiEnv) {
  const body = (await readJson(req)) as AgentReplyPayload;
  const provider = getProviderMode(env);
  console.info("[LawTriage Agent API] reply request", {
    provider,
    transcript: createTranscriptLogMeta(body.clientEvent?.text),
    turnIndex: body.turnIndex ?? 0,
  });

  if (provider === "volcengine") {
    const text = await createVolcArkReply(body, env);
    console.info("[LawTriage Agent API] reply response", { chars: text.length, provider });
    sendJson(res, 200, { text });
    return;
  }

  if (provider === "openai") {
    const text = await createOpenAiReply(body, env);
    console.info("[LawTriage Agent API] reply response", { chars: text.length, provider });
    sendJson(res, 200, { text });
    return;
  }

  sendProviderDisabled(res);
}

async function handleSpeech(req: IncomingMessage, res: ServerResponse, env: AgentApiEnv) {
  const body = (await readJson(req)) as { text?: string };
  const input = body.text?.trim();

  if (!input) {
    sendJson(res, 400, { error: "缺少 TTS 文本。" });
    return;
  }

  const provider = getProviderMode(env);
  console.info("[LawTriage Agent API] speech request", {
    chars: input.length,
    provider,
  });

  if (provider === "volcengine") {
    const audio = await createVolcSpeech(input, env);
    console.info("[LawTriage Agent API] speech response", { bytes: audio.byteLength, provider });
    sendBinary(res, 200, "audio/mpeg", audio);
    return;
  }

  if (provider === "openai") {
    const audio = await createOpenAiSpeech(input, env);
    console.info("[LawTriage Agent API] speech response", { bytes: audio.byteLength, provider });
    sendBinary(res, 200, "audio/mpeg", audio);
    return;
  }

  sendProviderDisabled(res);
}

async function handleTranscribe(req: IncomingMessage, res: ServerResponse, env: AgentApiEnv) {
  const audio = await readBuffer(req);

  if (audio.byteLength === 0) {
    sendJson(res, 400, { error: "缺少 ASR 音频。" });
    return;
  }

  const provider = getProviderMode(env);
  const contentType = req.headers["content-type"] || "audio/webm";

  if (provider === "volcengine") {
    sendJson(res, 200, { text: await createVolcTranscription(audio, contentType, env) });
    return;
  }

  if (provider === "openai") {
    sendJson(res, 200, { text: await createOpenAiTranscription(audio, contentType, env) });
    return;
  }

  sendProviderDisabled(res);
}

async function createOpenAiReply(body: AgentReplyPayload, env: AgentApiEnv): Promise<string> {
  const apiKey = requireEnv(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const upstream = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: createBearerJsonHeaders(apiKey),
    body: JSON.stringify({
      input: buildReplyInput(body),
      instructions: buildReplyInstructions(body.systemPrompt),
      max_output_tokens: 260,
      model: env.OPENAI_LLM_MODEL || defaultOpenAiLlmModel,
    }),
  });
  const payload = await readJsonResponse<OpenAiResponsePayload>(upstream, extractOpenAiError);

  return extractOpenAiResponseText(payload);
}

async function createOpenAiSpeech(input: string, env: AgentApiEnv): Promise<Buffer> {
  const apiKey = requireEnv(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const upstream = await fetchWithTimeout("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: createBearerJsonHeaders(apiKey),
    body: JSON.stringify({
      input,
      instructions: "使用自然、专业、克制的中文律所接待语气。必须让听者能意识到这是 AI 语音。",
      model: env.OPENAI_TTS_MODEL || defaultOpenAiTtsModel,
      response_format: "mp3",
      voice: env.OPENAI_TTS_VOICE || defaultOpenAiTtsVoice,
    }),
  });

  if (!upstream.ok) {
    throw new Error(await readOpenAiError(upstream));
  }

  return Buffer.from(await upstream.arrayBuffer());
}

async function createOpenAiTranscription(
  audio: Buffer,
  contentType: string | string[],
  env: AgentApiEnv,
): Promise<string> {
  const apiKey = requireEnv(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const form = new FormData();

  form.set("file", new Blob([audio], { type: getSingleHeader(contentType) }), getAudioFilename(contentType));
  form.set("language", "zh");
  form.set("model", env.OPENAI_ASR_MODEL || defaultOpenAiAsrModel);
  form.set("response_format", "json");

  const upstream = await fetchWithTimeout("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const payload = await readJsonResponse<OpenAiResponsePayload>(upstream, extractOpenAiError);

  return typeof payload.text === "string" ? payload.text.trim() : "";
}

async function createVolcArkReply(body: AgentReplyPayload, env: AgentApiEnv): Promise<string> {
  const apiKey = requireEnv(env.ARK_API_KEY, "ARK_API_KEY");
  const model = requireEnv(env.ARK_MODEL, "ARK_MODEL");
  const upstream = await fetchWithTimeout(`${trimTrailingSlash(env.ARK_BASE_URL || defaultArkBaseUrl)}/chat/completions`, {
    method: "POST",
    headers: createBearerJsonHeaders(apiKey),
    body: JSON.stringify({
      max_tokens: 260,
      messages: [
        {
          role: "system",
          content: buildReplyInstructions(body.systemPrompt),
        },
        {
          role: "user",
          content: buildReplyInput(body),
        },
      ],
      model,
      temperature: 0.3,
    }),
  });
  const payload = await readJsonResponse<ArkChatCompletionPayload>(upstream, extractArkError);

  return extractArkResponseText(payload);
}

async function createVolcSpeech(input: string, env: AgentApiEnv): Promise<Buffer> {
  const apiKey = requireEnv(env.VOLC_TTS_API_KEY, "VOLC_TTS_API_KEY");
  const voiceType = requireEnv(env.VOLC_TTS_VOICE_TYPE, "VOLC_TTS_VOICE_TYPE");
  const upstream = await fetchWithTimeout(env.VOLC_TTS_URL || defaultVolcTtsUrl, {
    method: "POST",
    headers: {
      "Connection": "keep-alive",
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Request-Id": randomUUID(),
      "X-Api-Resource-Id": env.VOLC_TTS_RESOURCE_ID || defaultVolcTtsResourceId,
    },
    body: JSON.stringify({
      req_params: {
        audio_params: {
          format: "mp3",
          sample_rate: 24000,
        },
        speaker: voiceType,
        text: input,
      },
      user: {
        uid: "lawtriage-demo",
      },
    }),
  });

  if (!upstream.ok) {
    throw new Error(await readTextError(upstream, "火山 TTS 请求失败。"));
  }

  const responseText = await upstream.text();
  const audioChunks = parseVolcTtsAudioChunks(responseText);

  if (audioChunks.length === 0) {
    throw new Error(`火山 TTS 未返回音频数据。logid=${upstream.headers.get("x-tt-logid") ?? "-"}`);
  }

  return Buffer.concat(audioChunks);
}

function connectVolcAsrRelay(client: WebSocket, env: AgentApiEnv) {
  let upstream: WebSocket | undefined;
  let finalSent = false;
  let receivedAudioChunks = 0;
  const emittedUtterances = new Set<string>();

  const closeBoth = () => {
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }

    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  };

  try {
    const apiKey = requireEnv(env.VOLC_ASR_API_KEY, "VOLC_ASR_API_KEY");
    const connectId = randomUUID();
    upstream = new WebSocket(env.VOLC_ASR_STREAM_WS_URL || defaultVolcAsrStreamWsUrl, {
      headers: {
        "X-Api-Connect-Id": connectId,
        "X-Api-Key": apiKey,
        "X-Api-Resource-Id": env.VOLC_ASR_RESOURCE_ID || defaultVolcAsrResourceId,
      },
    });

    upstream.on("open", () => {
      console.info("[LawTriage ASR relay] upstream open", connectId);
      upstream?.send(createVolcAsrFullClientRequest());
      sendClientAsrJson(client, { type: "ready" });
    });

    upstream.on("message", (data) => {
      try {
        const response = parseVolcAsrResponse(data);

        if (response.error) {
          sendClientAsrJson(client, { message: response.error, type: "error" });
          closeBoth();
          return;
        }

        for (const utterance of response.utterances) {
          const text = utterance.text.trim();

          if (!text || !utterance.definite) {
            continue;
          }

          const key = `${utterance.startTime}:${utterance.endTime}:${text}`;

          if (emittedUtterances.has(key)) {
            continue;
          }

          emittedUtterances.add(key);
          console.info("[LawTriage ASR relay] definite result", createTranscriptLogMeta(text));
          sendClientAsrJson(client, {
            definite: true,
            endTime: utterance.endTime,
            startTime: utterance.startTime,
            text,
            type: "result",
          });
        }

        if (response.utterances.length === 0 && response.text) {
          sendClientAsrJson(client, {
            definite: false,
            text: response.text,
            type: "result",
          });
        }
      } catch (error) {
        sendClientAsrJson(client, { message: getErrorMessage(error), type: "error" });
      }
    });

    upstream.on("error", (error) => {
      console.error("[LawTriage ASR relay] upstream error", getErrorMessage(error));
      sendClientAsrJson(client, { message: `火山 ASR WebSocket 错误：${getErrorMessage(error)}`, type: "error" });
      closeBoth();
    });

    upstream.on("close", (code, reason) => {
      console.info("[LawTriage ASR relay] upstream close", {
        audioChunks: receivedAudioChunks,
        code,
        reason: reason.toString(),
      });
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });

    client.on("message", (data, isBinary) => {
      if (!upstream || upstream.readyState !== WebSocket.OPEN) {
        return;
      }

      if (!isBinary) {
        const message = parseClientAsrMessage(data);

        if (message?.type === "end" && !finalSent) {
          finalSent = true;
          upstream.send(createVolcAsrAudioRequest(Buffer.alloc(0), true));
        }
        return;
      }

      const audio = rawDataToBuffer(data);

      if (audio.byteLength > 0) {
        receivedAudioChunks += 1;
        if (receivedAudioChunks === 1) {
          console.info("[LawTriage ASR relay] first audio chunk", audio.byteLength);
        }
        upstream.send(createVolcAsrAudioRequest(audio, false));
      }
    });

    client.on("close", () => {
      if (upstream && upstream.readyState === WebSocket.OPEN) {
        if (!finalSent) {
          upstream.send(createVolcAsrAudioRequest(Buffer.alloc(0), true));
        }
        upstream.close();
      }
    });

    client.on("error", closeBoth);
  } catch (error) {
    sendClientAsrJson(client, { message: getErrorMessage(error), type: "error" });
    closeBoth();
  }
}

async function createVolcTranscription(
  _audio: Buffer,
  _contentType: string | string[],
  env: AgentApiEnv,
): Promise<string> {
  requireEnv(env.VOLC_ASR_API_KEY, "VOLC_ASR_API_KEY");
  throw new Error(
    `火山实时 ASR 已改为浏览器麦克风 PCM -> 本地 /api/agent/asr WebSocket relay -> ${
      env.VOLC_ASR_STREAM_WS_URL || defaultVolcAsrStreamWsUrl
    }。当前 /api/agent/transcribe 只保留给 OpenAI blob ASR。`,
  );
}

function buildReplyInstructions(systemPrompt?: string): string {
  return [
    systemPrompt?.trim(),
    "你正在实时电话接待中，只输出下一句要播报给当事人的中文口语回复。",
    "回复要简洁自然，通常 1 到 3 句；不要输出 Markdown、JSON、编号或旁白。",
    "不要给确定法律结论，不承诺结果；需要判断时引导预约律师进一步确认。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildReplyInput(payload: AgentReplyPayload): string {
  const intake = payload.session?.intake;
  const transcript = payload.transcript ?? [];
  const transcriptText =
    transcript.length > 0
      ? transcript.map((event) => `${event.speaker === "agent" ? "AI" : "当事人"}：${event.text}`).join("\n")
      : "暂无历史转写。";

  return [
    `Session ID：${payload.session?.id ?? "-"}`,
    `客户：${intake?.clientName ?? "-"}，电话：${intake?.phone ?? "-"}，城市：${intake?.city ?? "-"}，案件类型：${intake?.caseType ?? "-"}`,
    `当前客户输入：${payload.clientEvent?.text ?? "请生成开场白。"}`,
    `客户轮次：${payload.turnIndex ?? 0}`,
    "历史转写：",
    transcriptText,
  ].join("\n");
}

function extractOpenAiResponseText(payload: OpenAiResponsePayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) {
        return content.text.trim();
      }
    }
  }

  throw new Error("OpenAI LLM 未返回文本。");
}

function extractArkResponseText(payload: ArkChatCompletionPayload): string {
  const text = payload.choices?.[0]?.message?.content;

  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }

  throw new Error("火山方舟未返回文本。");
}

function parseVolcTtsAudioChunks(responseText: string): Buffer[] {
  const chunks: Buffer[] = [];
  const records = extractJsonObjects(responseText);

  for (const record of records) {
    const payload = record as { code?: number; data?: string | null; message?: string };

    if (typeof payload.data === "string" && payload.data) {
      chunks.push(Buffer.from(payload.data, "base64"));
      continue;
    }

    if (payload.code && payload.code !== 0 && payload.code !== 20000000) {
      throw new Error(payload.message || `火山 TTS 返回错误码：${payload.code}`);
    }
  }

  return chunks;
}

function createVolcAsrFullClientRequest(): Buffer {
  const payload = gzipSync(
    Buffer.from(
      JSON.stringify({
        audio: {
          bits: 16,
          channel: 1,
          codec: "raw",
          format: "pcm",
          rate: 16000,
        },
        request: {
          enable_ddc: true,
          enable_itn: true,
          enable_punc: true,
          model_name: "bigmodel",
          show_utterances: true,
        },
        user: {
          uid: "lawtriage-demo",
        },
      }),
      "utf8",
    ),
  );

  return createVolcAsrFrame([0x11, 0x10, 0x11, 0x00], payload);
}

function createVolcAsrAudioRequest(audio: Buffer, isLast: boolean): Buffer {
  const payload = gzipSync(isLast ? Buffer.alloc(0) : audio);

  return createVolcAsrFrame([0x11, isLast ? 0x22 : 0x20, 0x11, 0x00], payload);
}

function createVolcAsrFrame(header: number[], payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.byteLength, 0);

  return Buffer.concat([Buffer.from(header), size, payload]);
}

function parseVolcAsrResponse(data: RawData): VolcAsrParsedResponse {
  const buffer = rawDataToBuffer(data);

  if (buffer.byteLength < 8) {
    throw new Error("火山 ASR 返回帧过短。");
  }

  const messageType = buffer[1] >> 4;
  const flags = buffer[1] & 0x0f;
  const headerSize = (buffer[0] & 0x0f) * 4;
  const offsetCandidates = flags === 0x01 || flags === 0x03 ? [headerSize + 4] : [headerSize, headerSize + 4];
  let lastError: unknown;

  for (const offset of offsetCandidates) {
    try {
      return parseVolcAsrPayload(buffer, offset, messageType);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("无法解析火山 ASR 返回帧。");
}

function parseVolcAsrPayload(buffer: Buffer, offset: number, messageType: number): VolcAsrParsedResponse {
  const serialization = buffer[2] >> 4;
  const compression = buffer[2] & 0x0f;

  if (buffer.byteLength < offset + 4) {
    return { utterances: [] };
  }

  const payloadSize = buffer.readUInt32BE(offset);
  offset += 4;

  if (payloadSize === 0) {
    return { utterances: [] };
  }

  let payload = buffer.subarray(offset, offset + payloadSize);

  if (compression === 0x01) {
    payload = gunzipSync(payload);
  }

  const text = payload.toString("utf8");
  let payloadJson: VolcAsrResponsePayload | undefined;

  if (serialization === 0x01 || text.trim().startsWith("{")) {
    try {
      payloadJson = JSON.parse(text) as VolcAsrResponsePayload;
    } catch (error) {
      if (messageType === 0x0f) {
        throw error;
      }

      return { utterances: [] };
    }
  }

  if (!payloadJson) {
    return messageType === 0x0f ? { error: text, utterances: [] } : { text, utterances: [] };
  }

  if (messageType === 0x0f || payloadJson.error) {
    return { error: payloadJson.error || payloadJson.message || "火山 ASR 返回错误。", utterances: [] };
  }

  return {
    text: payloadJson.result?.text?.trim(),
    utterances:
      payloadJson.result?.utterances?.map((utterance) => ({
        definite: Boolean(utterance.definite),
        endTime: utterance.end_time ?? 0,
        startTime: utterance.start_time ?? 0,
        text: utterance.text ?? "",
      })) ?? [],
  };
}

function parseClientAsrMessage(data: RawData): { type?: string } | undefined {
  try {
    return JSON.parse(rawDataToBuffer(data).toString("utf8")) as { type?: string };
  } catch {
    return undefined;
  }
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  return Buffer.from(data);
}

function sendClientAsrJson(client: WebSocket, payload: VolcAsrClientMessage) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

function extractJsonObjects(text: string): unknown[] {
  const records: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        records.push(JSON.parse(text.slice(start, index + 1)) as unknown);
        start = -1;
      }
    }
  }

  return records;
}

function requireEnv(value: string | undefined, name: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`缺少 ${name}。`);
  }

  return normalized;
}

function getProviderMode(env: AgentApiEnv): AgentProviderMode {
  if (env.VITE_AGENT_PROVIDER === "volcengine") {
    return "volcengine";
  }

  if (env.VITE_AGENT_PROVIDER === "openai") {
    return "openai";
  }

  return "dev";
}

function sendProviderDisabled(res: ServerResponse) {
  sendJson(res, 400, {
    error: "当前 VITE_AGENT_PROVIDER=dev，不会调用真实 Agent provider。",
  });
}

function createBearerJsonHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function readJsonResponse<T>(
  response: Response,
  getError: (payload: T) => string,
): Promise<T> {
  const payload = (await response.json()) as T;

  if (!response.ok) {
    throw new Error(getError(payload));
  }

  return payload;
}

async function readTextError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();

  return text.trim() || fallback;
}

async function readOpenAiError(response: Response): Promise<string> {
  try {
    return extractOpenAiError((await response.json()) as OpenAiResponsePayload);
  } catch {
    return `OpenAI 请求失败：HTTP ${response.status}`;
  }
}

function extractOpenAiError(payload: OpenAiResponsePayload): string {
  if (typeof payload.error?.message === "string") {
    return payload.error.message;
  }

  return "OpenAI 请求失败。";
}

function extractArkError(payload: ArkChatCompletionPayload): string {
  if (typeof payload.error?.message === "string") {
    return payload.error.message;
  }

  return "火山方舟请求失败。";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return JSON.parse((await readBuffer(req)).toString("utf8")) as unknown;
}

function readBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };

    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      req.pause();
      reject(error);
    };

    const onData = (chunk: Buffer) => {
      totalBytes += chunk.byteLength;

      if (totalBytes > maxRequestBodyBytes) {
        settleReject(new RequestBodyTooLargeError(maxRequestBodyBytes));
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, totalBytes));
    };

    const onError = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendBinary(res: ServerResponse, statusCode: number, contentType: string, payload: Buffer) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.end(payload);
}

function getAudioFilename(contentType: string | string[]): string {
  const value = getSingleHeader(contentType);

  if (value.includes("ogg")) {
    return "speech.ogg";
  }

  if (value.includes("mp4")) {
    return "speech.mp4";
  }

  if (value.includes("mpeg") || value.includes("mp3")) {
    return "speech.mp3";
  }

  return "speech.webm";
}

function getSingleHeader(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`上游 Agent provider 请求超过 ${Math.round(upstreamTimeoutMs / 1000)} 秒。`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function createTranscriptLogMeta(text: string | undefined) {
  const normalized = text?.replace(/\s+/g, " ").trim() ?? "";

  return {
    chars: normalized.length,
    redactedPreview: redactTranscriptPreview(normalized),
  };
}

function redactTranscriptPreview(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\d/g, "*")
    .replace(/[\u4e00-\u9fff]/g, "*")
    .slice(0, 32);
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type AgentReplyPayload = {
  clientEvent?: {
    speaker: string;
    text: string;
  };
  session?: {
    id?: string;
    intake?: {
      caseType?: string;
      city?: string;
      clientName?: string;
      phone?: string;
    };
  };
  systemPrompt?: string;
  transcript?: Array<{
    speaker: string;
    text: string;
  }>;
  turnIndex?: number;
};

type ArkChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type OpenAiResponsePayload = {
  error?: {
    message?: string;
  };
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
  output_text?: string;
  text?: string;
};

type VolcAsrClientMessage =
  | {
      type: "ready";
    }
  | {
      definite?: boolean;
      endTime?: number;
      startTime?: number;
      text: string;
      type: "result";
    }
  | {
      message: string;
      type: "error";
    };

type VolcAsrParsedResponse = {
  error?: string;
  text?: string;
  utterances: Array<{
    definite: boolean;
    endTime: number;
    startTime: number;
    text: string;
  }>;
};

type VolcAsrResponsePayload = {
  error?: string;
  message?: string;
  result?: {
    text?: string;
    utterances?: Array<{
      definite?: boolean;
      end_time?: number;
      start_time?: number;
      text?: string;
    }>;
  };
};
