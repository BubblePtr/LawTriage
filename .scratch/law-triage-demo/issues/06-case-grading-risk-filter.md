# 案件分级与敏感/无效标记

Status: completed
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

基于结构化档案生成可解释的案件大/中/小分级和风险标记。演示版先使用简单规则：标的额、紧急程度、案件复杂度、无效/敏感关键词共同决定结果，并在后台展示判断依据。

## Acceptance criteria

- [x] 分级结果只能是大、中、小之一。
- [x] 风险标记能区分正常、敏感、无效、恶意。
- [x] 每次分级都展示简短判断依据。
- [x] 至少有一条无效/敏感演示用例可触发风险标记。
- [x] 规则阈值集中定义，便于律师团队后续调整。

## Blocked by

- `.scratch/law-triage-demo/issues/05-triage-slots-structured-result.md`

## Comments

- 2026-05-30：已完成。新增 `src/caseAssessment.ts` 集中定义分级阈值、复杂/紧急信号和风险关键词；挂断后结构化结果会输出“大/中/小”分级、可解释判断依据，以及“正常/敏感/无效/恶意”风险标记。`sensitive-safety` 预设用例可触发敏感风险。
