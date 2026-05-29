# 案件分级与敏感/无效标记

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

基于结构化档案生成可解释的案件大/中/小分级和风险标记。演示版先使用简单规则：标的额、紧急程度、案件复杂度、无效/敏感关键词共同决定结果，并在后台展示判断依据。

## Acceptance criteria

- [ ] 分级结果只能是大、中、小之一。
- [ ] 风险标记能区分正常、敏感、无效、恶意。
- [ ] 每次分级都展示简短判断依据。
- [ ] 至少有一条无效/敏感演示用例可触发风险标记。
- [ ] 规则阈值集中定义，便于律师团队后续调整。

## Blocked by

- `.scratch/law-triage-demo/issues/05-triage-slots-structured-result.md`
