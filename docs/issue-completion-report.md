# LawTriage issue 完成报告

日期：2026-05-30

## 结论

`.scratch/law-triage-demo/issues/` 下 8 个 issue 均已完成，所有验收项已勾选，`Status:` 已同步为 `completed`。

## 完成范围

| Issue | 状态 | 关键交付 |
| --- | --- | --- |
| 01 演示应用骨架与 Session 闭环 | completed | React/Vite 工作台、session 创建/结束、结果面板。 |
| 02 实时字幕事件流 | completed | 按时间排序 transcript、双方字幕、结束后转写保留。 |
| 03 LiveKit RTC 接入与 MediaSession 适配 | completed | Dev Mock / LiveKit adapter、RTC 状态、配置入口、LiveKit 冒烟路径。 |
| 04 级联 Agent 最小对话链路 | completed | Dev ASR/LLM/TTS provider、开场与多轮回复、写回 transcript。 |
| 05 分诊槽位收集与结构化结果 | completed | 稳定槽位类型、规则提取、缺失字段、挂断结构化档案。 |
| 06 案件分级与敏感/无效标记 | completed | 集中规则阈值、案件大/中/小分级、正常/敏感/无效/恶意风险标记。 |
| 07 录音/转写留存与后台回放 | completed | 录音归档、占位 WAV、播放/暂停、完整转写查看、session 绑定。 |
| 08 演示 Runbook 与预设用例 | completed | 三条预设用例、应用下拉选择、演示 runbook 和 fallback。 |

## 主要代码变化

- `src/caseAssessment.ts`：集中定义案件分级阈值、复杂/紧急信号和风险关键词。
- `src/demoFixtures.ts`：定义标准婚家、专业追问、敏感风险三条演示用例。
- `src/demoSession.ts`：将用例快照绑定 session；挂断后生成分级、风险、录音归档和完整转写。
- `src/App.tsx`：新增用例选择、结果归档、完整转写和录音播放控制。
- `src/mediaSession.ts`：Dev Mock 按 session 绑定的用例 transcript 推送文本事件。
- `docs/demo-runbook.md`：新增演示前准备、标准操作、LiveKit 验证、失败 fallback 和清理步骤。

## 验证结果

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 构建 | 通过 | `bun run build` 成功；仅保留 LiveKit chunk 体积警告。 |
| Issue 状态 | 通过 | 8 个 issue 均为 `Status: completed`，验收项均为 `[x]`。 |
| 规则分支 | 通过 | Bun 脚本覆盖正常/敏感/无效/恶意风险，以及大/中/小分级分支。 |
| 页面身份 | 通过 | URL `http://127.0.0.1:5174/`，标题 `律所 AI 外呼分诊演示系统`。 |
| 空白/框架错误页 | 通过 | DOM 和截图均显示完整工作台，无 Vite/React error overlay。 |
| 主流程交互 | 通过 | 选择 `sensitive-safety` + `Dev Mock`，开始通话，生成 9/9 转写，挂断后结果生成。 |
| 分级/风险 | 通过 | 敏感用例输出分级 `中`，风险 `敏感`，命中词 `家暴`。 |
| 录音/转写归档 | 通过 | 结果包含 `REC-CALL-*` 归档编号、绑定 session、播放/暂停按钮和完整转写。 |
| 控制台健康 | 通过 | Playwright/Chrome 复验无 error/warning；已补 favicon 消除默认 404。 |
| 响应式首屏 | 通过 | 390x844 移动端首屏正常显示客户录入、用例选择和 RTC 区域。 |

截图证据：

- 桌面结果态：`/tmp/lawtriage-qa-desktop.png`
- 移动端首屏：`/tmp/lawtriage-qa-mobile.png`

## 已知边界

- 当前录音是静音占位 WAV，用于验证归档和播放控制；真实 RTC 录音仍需后端录制服务接入。
- `LiveKit` chunk 超过 Vite 默认 500 kB 提示阈值，但不影响构建或演示运行。
- `.env.local` 中的真实 LiveKit token 不应提交；演示默认可切回 `Dev Mock`。

## 运行入口

本地验证使用：

```bash
bun run dev -- --host 127.0.0.1
```

本次 dev server 使用端口：

```text
http://127.0.0.1:5174/
```
