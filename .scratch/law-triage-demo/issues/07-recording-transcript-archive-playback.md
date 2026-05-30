# 录音/转写留存与后台回放

Status: completed
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

在通话结束后保留演示录音 URL 或占位音频、完整转写和结构化结果，后台可以查看转写并播放录音。真实 RTC 录音未接入前，允许使用稳定的演示音频占位。

## Acceptance criteria

- [x] session 结束后保存完整 transcript。
- [x] session 结束后存在 recording URL 或明确的占位音频资源。
- [x] 后台能播放、暂停录音。
- [x] 后台能查看完整转写。
- [x] 录音/转写数据与对应 session 绑定。

## Blocked by

- `.scratch/law-triage-demo/issues/03-livekit-rtc-mediasession-adapter.md`
- `.scratch/law-triage-demo/issues/05-triage-slots-structured-result.md`

## Comments

- 2026-05-30：已完成。`StructuredResult` 增加 `recording` 归档信息，包含归档编号、绑定 session、占位 WAV data URL 和时长；结果面板新增录音播放/暂停控制和完整转写归档区。
