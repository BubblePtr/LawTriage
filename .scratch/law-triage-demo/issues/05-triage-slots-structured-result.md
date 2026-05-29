# 分诊槽位收集与结构化结果

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/law-triage-demo/PRD.md`

## What to build

围绕婚姻家事演示场景收集分诊必填要素，并在挂断后输出结构化 JSON 档案。字段包括客户称呼、联系电话、案件类型、所在地、争议金额/标的、紧急程度、核心诉求、是否已有律师、期望沟通时间和完整转写。

## Acceptance criteria

- [ ] 分诊字段有稳定类型定义。
- [ ] Agent 或 dev flow 能逐步填充分诊槽位。
- [ ] 未收集完整时，结果明确标出缺失字段。
- [ ] 挂断后生成结构化档案。
- [ ] 后台以可读方式展示档案字段。

## Blocked by

- `.scratch/law-triage-demo/issues/04-cascaded-agent-minimal-dialogue.md`
