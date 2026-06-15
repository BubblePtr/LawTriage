# RTC 接入说明

演示版当前支持三种媒体模式：

- `Dev Mock`：默认模式，不需要 LiveKit 凭证，用于本地演示 session、实时字幕和通话后结构化结果。
- `本机麦克风`：真实级联调试模式，浏览器直接采集本机麦克风并走真实 ASR / LLM / TTS。
- `LiveKit`：真实 RTC 模式，浏览器连接 LiveKit room 并发布本地麦克风音轨；启用真实 Agent provider 时，由服务端 LiveKit Agent worker 作为房间参与者订阅音频、执行级联 ASR / LLM / TTS，并把语音和转写发布回同一个 room。

## 本地配置

复制 `.env.example` 并填入本地环境变量：

```bash
cp .env.example .env.local
```

```dotenv
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_PARTICIPANT_TOKEN_TTL_SECONDS=1800
```

浏览器 participant token 不需要写进 `.env.local`。点击“开始咨询”时，Vite 本地后端会通过 `/api/livekit/token` 使用 `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` 签发短期 token。不要把 LiveKit API secret 放进前端环境变量，也不要提交到仓库。修改 `.env.local` 后需要重启 Vite dev server。

## LiveKit Agent worker

LiveKit 模式的真实 Agent 不再运行在浏览器内。浏览器只负责入房、发布麦克风、播放远端 Agent 音轨、接收 LiveKit transcription 事件；服务端 worker 负责真正的级联语音 Agent。

`.env.local` 需要同时包含前端可见的 LiveKit URL、服务端 token 签发凭证和 worker 凭证：

```dotenv
VITE_AGENT_PROVIDER=volcengine
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud

LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_PARTICIPANT_TOKEN_TTL_SECONDS=1800

# LiveKit worker 默认复用本地火山级联链路。
AGENT_PROVIDER=volcengine

# 火山方舟 LLM
ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=ep-...

# 豆包语音 ASR
VOLC_ASR_API_KEY=...
VOLC_ASR_RESOURCE_ID=volc.seedasr.sauc.duration
VOLC_ASR_STREAM_WS_URL=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
LIVEKIT_AGENT_ASR_TURN_SILENCE_MS=1200

# 豆包语音 TTS
VOLC_TTS_API_KEY=...
VOLC_TTS_RESOURCE_ID=seed-tts-2.0
VOLC_TTS_VOICE_TYPE=你的音色 ID
VOLC_TTS_URL=https://openspeech.bytedance.com/api/v3/tts/unidirectional
```

如果只想先验证火山本地链路，不需要 LiveKit API key，可以直接运行：

```bash
bun run agent:validate-volcengine
```

这个命令会用同一组 `ARK_*`、`VOLC_ASR_*`、`VOLC_TTS_*` 环境变量跑一遍 `TTS -> ASR -> Ark -> TTS`。它验证的是火山级联可用性，不会连接 LiveKit room。

本地 LiveKit 调试推荐使用组合命令：

```bash
bun run dev:livekit
```

这个命令会同时启动 Vite 网页和 LiveKit Agent worker，并在其中一个进程退出或按下 `Ctrl-C` 时清理另一侧。如果需要指定 Vite 参数，可以继续转发，例如 `bun run dev:livekit -- --host 127.0.0.1 --port 5174`。

如需拆分日志或单独排障，仍可分别运行：

```bash
bun run agent:dev
bun run dev
```

`LIVEKIT_AGENT_NAME` 默认留空，便于本地开发时自动接入房间。生产环境如果启用显式 dispatch，再设置固定 agent name，并由后端 token service 或 dispatch API 指定要拉起的 Agent。

如果显式设置 `AGENT_PROVIDER=inference`，worker 才会使用 `LIVEKIT_AGENT_STT_MODEL`、`LIVEKIT_AGENT_LLM_MODEL`、`LIVEKIT_AGENT_TTS_MODEL` 这些 LiveKit Inference Gateway 模型字符串。默认本地开发不需要这些变量；只要 `.env.local` 里有 `VITE_AGENT_PROVIDER=volcengine` 或完整 `ARK_*` / `VOLC_*` 配置，worker 会自动选择火山链路。

LiveKit Agent worker 的链路为：

```text
浏览器 participant
  -> LiveKit room 发布麦克风 track
  -> LiveKit Agent worker 作为 Agent participant 加入 room
  -> RoomIO 订阅客户音频
  -> STT
  -> LLM
  -> TTS
  -> Agent 音频 track + transcription 发布回 room
  -> 浏览器播放远端 Agent 音频并写入 transcript
```

## 真实 ASR / LLM / TTS

默认 `VITE_AGENT_PROVIDER=dev` 使用本地 dev provider，适合稳定演示和回归。

### 火山引擎

接入火山 provider 时，本地 `.env.local` 增加：

```dotenv
VITE_AGENT_PROVIDER=volcengine

# 火山方舟 LLM
ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=ep-...

# 豆包语音 ASR
VOLC_ASR_API_KEY=...
VOLC_ASR_RESOURCE_ID=volc.seedasr.sauc.duration
VOLC_ASR_STREAM_WS_URL=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
LIVEKIT_AGENT_ASR_TURN_SILENCE_MS=1200

# 豆包语音 TTS
VOLC_TTS_API_KEY=...
VOLC_TTS_RESOURCE_ID=seed-tts-2.0
VOLC_TTS_VOICE_TYPE=你的音色 ID
VOLC_TTS_URL=https://openspeech.bytedance.com/api/v3/tts/unidirectional
```

选择 `本机麦克风` 后链路变为：

```text
MediaSession 音频输入（本机麦克风）
  -> Web Audio 重采样为 16k mono PCM
  -> 检测到客户说话后懒启动 ASR
  -> 本地 /api/agent/asr WebSocket relay
  -> 火山大模型流式 ASR
  -> definite 分句 text event
  -> 火山方舟 Chat Completions
  -> /api/agent/speech
  -> 豆包语音 TTS
  -> transcript/result
```

火山 ASR 的正式路径是大模型流式语音识别 WebSocket，不是录音文件极速版识别。浏览器不能直接给火山 WebSocket 注入鉴权 Header，所以本地 Vite middleware 提供 `/api/agent/asr` relay：浏览器只发送 16k PCM，服务端负责火山二进制协议、Gzip framing 和 `X-Api-Key` / `X-Api-Resource-Id`。

```text
Web Audio 采集/重采样 16k PCM
  -> ws://localhost:5173/api/agent/asr
  -> wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
  -> definite 分句结果
  -> transcript/LLM
```

### OpenAI 备用路径

OpenAI provider 仍保留作为备用，本地 `.env.local` 增加：

```dotenv
VITE_AGENT_PROVIDER=openai

# 仅服务端读取，不要加 VITE_ 前缀，也不要提交。
OPENAI_API_KEY=sk-...
OPENAI_ASR_MODEL=gpt-4o-mini-transcribe
OPENAI_LLM_MODEL=gpt-4.1-mini
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=coral
```

OpenAI 链路为：

```text
MediaSession 麦克风分段录音
  -> /api/agent/transcribe
  -> OpenAI ASR
  -> text event
  -> OpenAI Responses LLM
  -> /api/agent/speech
  -> OpenAI TTS
  -> transcript/result
```

外部 provider 的 API key 只在 Vite dev/preview 的本地 API middleware 中使用，前端 bundle 只能看到 `VITE_AGENT_PROVIDER`。修改 provider 或 key 后需要重启 dev server。

豆包语音新版控制台使用 `X-Api-Key` 鉴权；代码默认不再发送旧版控制台的 `X-Api-App-Key` / `X-Api-Access-Key`。流式 ASR 建连时还需要传 `X-Api-Resource-Id=volc.seedasr.sauc.duration` 和随机 request/connect id。

火山 ASR 使用浏览器 Web Audio 推送 PCM；OpenAI 备用 ASR 仍使用 `MediaRecorder` 分段上传。现场验证时建议戴耳机，避免 TTS 扬声器回放被麦克风再次收进去；代码会在本地 TTS 播放期间暂停 ASR PCM 推流，降低回声回灌概率。

为避免开场白等待期触发火山流式 ASR 空闲超时，本机麦克风真实 provider 模式不会在点击“开始咨询”时立即打开上游 ASR WebSocket。浏览器先完成本机麦克风采集，等检测到客户开始说话后再连接 `/api/agent/asr` 并发送短暂缓存的 PCM；Agent TTS 播放时会主动结束当前 ASR 流，下一轮客户说话时重新建立。

火山 ASR 的 `definite` 表示“当前 ASR 分段稳定”，不等同于“客户一轮说完”。前端会先缓冲 definite 分段，并从最后一次 definite 到达时开始轮次计时；普通内容约 1.6 秒无新 definite 即可发送给 LLM，极短碎片会延长到约 3 秒。VAD 只做保护：flush 当下如果最近 650ms 仍检测到本地人声，就继续延后。

## 当前边界

演示版已把 `MediaSession` 抽象接入 cascaded Agent。`Dev Mock` 只产生内置模拟文本事件，Agent 回复会写回 transcript；`本机麦克风` 用于在没有 LiveKit room 的情况下验证现有本地 provider 级联；`LiveKit` 负责浏览器入房和麦克风发布，并在真实 provider 模式下等待 LiveKit Agent worker 在房间内完成级联处理。

启用 `openai` 或 `volcengine` provider 后，优先选择 `本机麦克风` 验证现有本地 provider；需要验证 RTC 房间时，先启动 `bun run agent:dev`，再切到 `LiveKit`。

没有 LiveKit 凭证时，继续使用 `Dev Mock` 模式即可完整验证演示主流程。
