# 录音/转写留存与后台回放

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

在通话结束后保留演示录音 URL 或占位音频、完整转写和结构化结果，后台可以查看转写并播放录音。真实 RTC 录音未接入前，允许使用稳定的演示音频占位。

## Acceptance criteria

- [ ] session 结束后保存完整 transcript。
- [ ] session 结束后存在 recording URL 或明确的占位音频资源。
- [ ] 后台能播放、暂停录音。
- [ ] 后台能查看完整转写。
- [ ] 录音/转写数据与对应 session 绑定。

## Blocked by

- `.scratch/law-triage-demo/issues/03-livekit-rtc-mediasession-adapter.md`
- `.scratch/law-triage-demo/issues/05-triage-slots-structured-result.md`
