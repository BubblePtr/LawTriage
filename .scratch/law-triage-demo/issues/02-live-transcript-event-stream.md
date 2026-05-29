# 实时字幕事件流

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

为 session 增加 transcript 事件流，让当事人端和演示后台能通过同一份会话事件看到双方字幕。先支持模拟 transcript 事件，后续可替换为真实 ASR 和 Agent 输出。

## Acceptance criteria

- [ ] session 中存在按时间排序的 transcript 事件。
- [ ] 字幕能区分当事人与 AI 分诊 Agent。
- [ ] 创建 session 后可以播放一段模拟对话字幕。
- [ ] 后台当前会话区域实时展示新增字幕。
- [ ] 结束 session 后完整转写保留在结构化结果中。

## Blocked by

- `.scratch/law-triage-demo/issues/01-demo-app-session-loop.md`
