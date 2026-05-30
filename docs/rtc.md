# RTC 接入说明

演示版当前支持两种媒体模式：

- `Dev Mock`：默认模式，不需要 LiveKit 凭证，用于本地演示 session、实时字幕和通话后结构化结果。
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

## 当前边界

本切片只建立 `MediaSession` 抽象和浏览器 RTC 接入点。后续 Agent、ASR、TTS、打断和真实 transcript 输入会在后续 issue 中接入。

没有 LiveKit 凭证时，继续使用 `Dev Mock` 模式即可完整验证 issue 01 和 issue 02 的流程。
