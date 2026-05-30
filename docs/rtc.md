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

## 当前边界

本切片只建立 `MediaSession` 抽象和浏览器 RTC 接入点。后续 Agent、ASR、TTS、打断和真实 transcript 输入会在后续 issue 中接入。

没有 LiveKit 凭证时，继续使用 `Dev Mock` 模式即可完整验证 issue 01 和 issue 02 的流程。
