# 演示 Runbook 与预设用例

Status: completed
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

准备客户复演所需的演示脚本、彩排 checklist、fallback 操作说明和三条预设用例：标准婚家咨询、含专业追问咨询、无效/敏感咨询。让演示者能稳定复现 PRD 中的完整故事。

## Acceptance criteria

- [x] 存在标准婚家咨询用例。
- [x] 存在含专业追问的用例。
- [x] 存在无效/敏感咨询用例。
- [x] runbook 覆盖演示前准备、现场操作、失败 fallback 和演示后清理。
- [x] 用例字段能直接喂给演示应用或 dev flow。

## Blocked by

- `.scratch/law-triage-demo/issues/06-case-grading-risk-filter.md`
- `.scratch/law-triage-demo/issues/07-recording-transcript-archive-playback.md`

## Comments

- 2026-05-30：已完成。新增 `src/demoFixtures.ts` 三条可复演用例，演示应用左侧可直接选择并绑定到 session；新增 `docs/demo-runbook.md`，覆盖准备、标准操作、LiveKit 验证、失败 fallback 和演示后清理。
