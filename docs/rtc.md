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

演示版已把 `MediaSession` 抽象接入 dev cascaded Agent。`Dev Mock` 会产生客户文本事件，Agent 回复会写回 transcript；`LiveKit` 当前负责浏览器入房和麦克风发布，真实 ASR/TTS 服务仍可通过 provider 层替换。

没有 LiveKit 凭证时，继续使用 `Dev Mock` 模式即可完整验证演示主流程。
