# LiveKit RTC 接入与 MediaSession 适配

Status: needs-info
Type: HITL

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

接入 LiveKit RTC，让浏览器能进入演示 room、完成麦克风授权、播放远端音频，并通过 MediaSession 抽象层把 RTC ingress 与后续 Agent 链路隔离。没有真实 LiveKit endpoint/API key 时，保留 dev/mock adapter，确保本地演示不被外部依赖阻塞。

## Acceptance criteria

- [ ] 能配置 LiveKit endpoint、API key、API secret 或等价 token service。
- [ ] 浏览器能加入 room 并完成麦克风授权。
- [ ] UI 能明确展示 RTC 连接状态和失败原因。
- [ ] MediaSession 对上层只暴露稳定的 session/audio/text 事件接口。
- [ ] 无 LiveKit 凭证时 dev/mock adapter 仍可运行第 1、2 条切片。

## Blocked by

- `.scratch/law-triage-demo/issues/01-demo-app-session-loop.md`
- LiveKit endpoint/API key/API secret 或确认继续使用 mock adapter
