# 级联 Agent 最小对话链路

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

让 MediaSession 产生的音频或文本事件进入最小 Agent 链路，Agent 使用资深律师接待话术生成回复，并把 AI reply 写回字幕流。ASR、LLM、TTS 先保持接口化，允许使用 dev provider 跑通链路，再替换真实 provider。

## Acceptance criteria

- [ ] Agent 有明确 system prompt，覆盖开场、共情、追问、收尾预约的基础话术。
- [ ] 用户输入事件能触发 AI reply。
- [ ] AI reply 会进入 transcript 事件流。
- [ ] provider 层可被 dev/mock 和真实服务替换。
- [ ] 本地无外部 provider 凭证时仍能跑通一段演示对话。

## Blocked by

- `.scratch/law-triage-demo/issues/02-live-transcript-event-stream.md`
- `.scratch/law-triage-demo/issues/03-livekit-rtc-mediasession-adapter.md`
