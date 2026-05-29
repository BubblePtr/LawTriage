# 律所 AI 外呼分诊系统 - 演示版 PRD 拆解

来源：`律所AI外呼分诊系统-演示版PRD.md`

## 范围

本 feature 只覆盖演示版（Pre-MVP）闭环：浏览器留资、演示通话 session、实时字幕展示、通话后结构化档案、案件分级、风险标记、录音/转写留存和演示 runbook。

## 默认决策

- 细分领域：婚姻家事
- RTC：LiveKit，凭证未就绪时使用 dev/mock adapter
- 语音架构：级联 ASR -> LLM -> TTS
- 声音复刻：不进入 P0
- 分级规则：先使用可解释规则
- 演示设备：优先笔记本浏览器，手机作为兼容验证

## Issue 列表

1. `issues/01-demo-app-session-loop.md`
2. `issues/02-live-transcript-event-stream.md`
3. `issues/03-livekit-rtc-mediasession-adapter.md`
4. `issues/04-cascaded-agent-minimal-dialogue.md`
5. `issues/05-triage-slots-structured-result.md`
6. `issues/06-case-grading-risk-filter.md`
7. `issues/07-recording-transcript-archive-playback.md`
8. `issues/08-demo-runbook-fixtures.md`
