# RTC 接入说明

演示版当前支持三种媒体模式：

- `Dev Mock`：默认模式，不需要 LiveKit 凭证，用于本地演示 session、实时字幕和通话后结构化结果。
- `本机麦克风`：真实级联调试模式，浏览器直接采集本机麦克风并走真实 ASR / LLM / TTS。
- `LiveKit`：真实 RTC 模式，浏览器会连接 LiveKit room 并发布本地麦克风音轨。

## 本地配置

复制 `.env.example` 并填入本地环境变量：

```bash
cp .env.example .env.local
```

```dotenv
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
VITE_LIVEKIT_TOKEN=short-lived-participant-token
```

`VITE_LIVEKIT_TOKEN` 应由后端 token service 签发。不要把 LiveKit API secret 放进前端环境变量，也不要提交到仓库。

如果使用 `lk` CLI 生成本地演示 token，注意 `lk token create --token-only` 可能先输出一行 project 提示，并且 token 可能折行。写入 `.env.local` 时只提取真正的 JWT 行：

```bash
LIVEKIT_URL="wss://your-project.livekit.cloud"
TOKEN="$(
  lk token create \
    --project your-project-name \
    --room law-triage-demo \
    --identity demo-browser \
    --name "Demo Browser" \
    --join \
    --allow-source microphone \
    --valid-for 2h \
    --token-only |
    awk '/^eyJ/ { print; exit }'
)"

printf 'VITE_LIVEKIT_URL=%s\nVITE_LIVEKIT_TOKEN=%s\n' "$LIVEKIT_URL" "$TOKEN" > .env.local
```

修改 `.env.local` 后需要重启 Vite dev server。

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

# 豆包语音 TTS
VOLC_TTS_API_KEY=...
VOLC_TTS_RESOURCE_ID=seed-tts-2.0
VOLC_TTS_VOICE_TYPE=你的音色 ID
VOLC_TTS_URL=https://openspeech.bytedance.com/api/v3/tts/unidirectional
```

选择 `本机麦克风` 后链路变为：

```text
MediaSession 麦克风采集
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

为避免开场白等待期触发火山流式 ASR 空闲超时，本机麦克风模式不会在点击“开始咨询”时立即打开上游 ASR WebSocket。浏览器先完成麦克风授权和采集，等检测到客户开始说话后再连接 `/api/agent/asr` 并发送短暂缓存的 PCM；Agent TTS 播放时会主动结束当前 ASR 流，下一轮客户说话时重新建立。

火山 ASR 的 `definite` 表示“当前 ASR 分段稳定”，不等同于“客户一轮说完”。前端会先缓冲 definite 分段，并从最后一次 definite 到达时开始轮次计时；普通内容约 1.6 秒无新 definite 即可发送给 LLM，极短碎片会延长到约 3 秒。VAD 只做保护：flush 当下如果最近 650ms 仍检测到本地人声，就继续延后。

## 当前边界

演示版已把 `MediaSession` 抽象接入 cascaded Agent。`Dev Mock` 只产生内置模拟文本事件，Agent 回复会写回 transcript；`本机麦克风` 用于在没有 LiveKit room 的情况下验证真实 ASR / LLM / TTS 级联；`LiveKit` 负责浏览器入房和麦克风发布。

启用 `openai` 或 `volcengine` provider 后，优先选择 `本机麦克风` 验证真实级联；需要验证 RTC 房间时再切到 `LiveKit`。

没有 LiveKit 凭证时，继续使用 `Dev Mock` 模式即可完整验证演示主流程。
