# LiveKit RTC 接入与 MediaSession 适配

Status: completed
Type: HITL

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

接入 LiveKit RTC，让浏览器能进入演示 room、完成麦克风授权、播放远端音频，并通过 MediaSession 抽象层把 RTC ingress 与后续 Agent 链路隔离。没有真实 LiveKit endpoint/API key 时，保留 dev/mock adapter，确保本地演示不被外部依赖阻塞。

## Acceptance criteria

- [x] 能配置 LiveKit endpoint、API key、API secret 或等价 token service。
- [x] 浏览器能加入 room 并完成麦克风授权。
- [x] UI 能明确展示 RTC 连接状态和失败原因。
- [x] MediaSession 对上层只暴露稳定的 session/audio/text 事件接口。
- [x] 无 LiveKit 凭证时 dev/mock adapter 仍可运行第 1、2 条切片。

## Blocked by

- `.scratch/law-triage-demo/issues/01-demo-app-session-loop.md`
- LiveKit endpoint/API key/API secret 或确认继续使用 mock adapter

## Comments

- 2026-05-30：已完成首轮实现。新增 `MediaSession` adapter 抽象、默认 Dev Mock adapter、LiveKit adapter、RTC 状态 UI、LiveKit URL/token 配置入口和 `.env.example`。无 LiveKit 凭证时，Dev Mock 仍可跑通 issue 01/02 的 session 与实时字幕流程；切到 LiveKit 但缺少配置时会显示明确失败原因。真实 LiveKit 入房与麦克风发布代码路径已实现，但仍需短期 participant token 做现场验证。
- 2026-05-30：已用 `lawtriage` LiveKit Cloud 项目和短期 participant token 做过本地冒烟验证。页面默认读取 `.env.local` 后选择 LiveKit；headless Chrome fake microphone 可进入 room、发布麦克风音轨，并继续启动模拟 transcript 流。
- 2026-05-30：已同步完成态。验收项全部勾选；最新构建继续通过。
