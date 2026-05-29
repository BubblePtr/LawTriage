# 演示应用骨架与 Session 闭环

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

建立演示应用的最小可运行骨架，让演示操作者可以录入客户信息、创建一通演示 session、在后台看到进行中的 session，并在结束通话后看到一份自动生成的结构化档案占位结果。

本切片不接真实 RTC、ASR、LLM 或 TTS；重点是把产品主路径和状态模型跑通，为后续真实语音链路提供稳定承载面。

## Acceptance criteria

- [ ] 应用可本地启动，首屏就是可操作的演示工作台，而不是营销页。
- [ ] 操作者能填写手机号、案件类型、客户称呼、所在城市，并点击“开始咨询”创建 session。
- [ ] 创建 session 后，后台区域显示会话 ID、开始时间、通话状态和通话时长。
- [ ] 操作者能点击“结束通话”，session 状态变为已结束。
- [ ] 结束后自动生成客户档案、案件分级、预约信息、风险标记的占位结构化结果。
- [ ] UI 状态刷新不依赖后端服务，便于后续替换为真实 API。

## Blocked by

None - can start immediately

## Comments

- 2026-05-30：已完成首轮实现。新增 React + Vite + Bun 项目骨架、本地 session 状态、留资表单、当前会话看板、结束通话后的结构化档案占位结果；已通过 `bun run build` 和本地浏览器核心交互验证。
