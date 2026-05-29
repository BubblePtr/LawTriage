# 演示 Runbook 与预设用例

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

准备客户复演所需的演示脚本、彩排 checklist、fallback 操作说明和三条预设用例：标准婚家咨询、含专业追问咨询、无效/敏感咨询。让演示者能稳定复现 PRD 中的完整故事。

## Acceptance criteria

- [ ] 存在标准婚家咨询用例。
- [ ] 存在含专业追问的用例。
- [ ] 存在无效/敏感咨询用例。
- [ ] runbook 覆盖演示前准备、现场操作、失败 fallback 和演示后清理。
- [ ] 用例字段能直接喂给演示应用或 dev flow。

## Blocked by

- `.scratch/law-triage-demo/issues/06-case-grading-risk-filter.md`
- `.scratch/law-triage-demo/issues/07-recording-transcript-archive-playback.md`
