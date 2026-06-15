# 演示 Runbook 与预设用例

## 演示目标

用浏览器完成一通婚姻家事 AI 外呼分诊演示：选择预设用例，创建 session，观察实时字幕和 Agent 回复，挂断后检查结构化档案、案件分级、风险标记、录音占位和完整转写归档。

## 演示前准备

- 确认依赖已安装：`bun install`
- 本地启动：`bun run dev`
- 默认使用 `Dev Mock` 媒体模式，不需要外部 RTC 凭证。
- 如需验证 LiveKit，先按 `docs/rtc.md` 写入 `.env.local`，再重启 Vite。
- 如需验证真实 ASR/LLM/TTS，设置 `VITE_AGENT_PROVIDER=volcengine` 并按 `docs/rtc.md` 填入火山服务端环境变量，再重启 Vite。
- 如需先独立验证本地火山级联链路，运行 `bun run agent:validate-volcengine`。
- 如需验证真正的 LiveKit Agent 房间流程，确认 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` 已配置，再另开终端启动 `bun run agent:dev`。
- 准备浏览器麦克风授权；`本机麦克风` 和 `LiveKit` 模式下需要允许麦克风。

## 预设用例

| 用例 ID | 名称 | 输入来源 | 预期分级 | 预期风险 | 适用场景 |
| --- | --- | --- | --- | --- | --- |
| `standard-divorce-property` | 标准婚家咨询 | 左侧“演示用例”下拉或 `src/demoFixtures.ts` | 大 | 正常 | 展示完整主路径：离婚、共同房产、存款转移、预约。 |
| `professional-follow-up` | 含专业追问咨询 | 左侧“演示用例”下拉或 `src/demoFixtures.ts` | 大 | 正常 | 展示更复杂财产、股权、证据材料和专业追问。 |
| `sensitive-safety` | 敏感风险咨询 | 左侧“演示用例”下拉或 `src/demoFixtures.ts` | 中 | 敏感 | 展示家暴、人身威胁、未成年人安全等敏感风险 fallback。 |

预设用例的 `intake` 和 `clientTranscript` 字段可直接喂给演示应用或 dev flow。演示应用会在创建 session 时把当前用例快照绑定到 session，避免演示中切换用例影响已开始的通话。

## 标准操作

1. 打开本地演示应用。
2. 选择一个“演示用例”，确认客户姓名、手机号、案件类型和城市已自动填入。
3. 媒体模式保持 `Dev Mock`，点击“开始咨询”。
4. 观察当前会话区：
   - 会话 ID、开始时间、通话状态和时长出现。
   - 实时字幕按时间顺序追加。
   - 字幕区分“当事人”和“AI 分诊 Agent”。
5. 等待预设对话播放完，点击“结束通话”。
6. 检查右侧结果：
   - 客户档案和分诊槽位已生成。
   - 案件分级展示“大/中/小”和判断依据。
   - 风险标记展示“正常/敏感/无效/恶意”和命中说明。
   - 录音归档有编号、绑定 session、占位录音和播放/暂停按钮。
   - 完整转写可查看全部行。

## LiveKit 验证路径

1. 确认 `.env.local` 有 `VITE_LIVEKIT_URL`、`LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`；浏览器 participant token 会由本地后端短期签发。
2. 先运行 `bun run agent:validate-volcengine`，确认本地火山 `TTS -> ASR -> Ark -> TTS` 级联可用。
3. 如需真实 Agent，确认 `.env.local` 有 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`、`AGENT_PROVIDER=volcengine` 和火山 `ARK_*` / `VOLC_*` 配置。
4. 启动 `bun run dev:livekit`。
5. 如果需要拆分排障，再分别运行 `bun run agent:dev` 和 `bun run dev`。
6. 左侧媒体模式选择 `LiveKit`。
7. 点击“开始咨询”，浏览器允许麦克风。
8. 确认 RTC 状态进入“已连接”，并在失败时检查 UI 展示的明确错误。
9. 启用真实 Agent provider 时，实时转写应来自 LiveKit room 的 transcription 事件，Agent 回复应以远端 Agent 音轨播放。

`VITE_AGENT_PROVIDER=dev` 时，LiveKit 模式仍可用于验证浏览器入房和麦克风发布，但对话事件走内置演示文本流。

## 本机真实级联 Provider 验证路径

1. 按 `docs/rtc.md` 配置 `VITE_AGENT_PROVIDER=volcengine`、火山方舟、豆包 ASR 和豆包 TTS 环境变量。
2. 重启 `bun run dev`。
3. 左侧媒体模式选择 `本机麦克风`。
4. 点击“开始咨询”，浏览器允许麦克风。
5. 先用 `/api/agent/reply` 和 `/api/agent/speech` 验证火山方舟回复和豆包 TTS 播报。
6. ASR 会通过本地 `/api/agent/asr` WebSocket relay 接入火山大模型流式语音识别；不要用录音文件极速版替代实时链路。
7. 点击“结束通话”，检查右侧结构化档案仍按 transcript/result 链路生成。需要验证 RTC 房间时，改走上面的 LiveKit Agent worker 路径。

## 失败 Fallback

- LiveKit token 签发失败或 URL 不正确：确认 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` 后重启 dev server；必要时切回 `Dev Mock`，继续完成演示主路径。
- 火山 API key、音色或资源 ID 未开通：切回 `VITE_AGENT_PROVIDER=dev` 并重启 dev server，继续使用稳定演示链路。新版控制台只需要 API Key，不需要旧版 App Key / Access Key。
- 浏览器麦克风授权失败：刷新页面后重新授权；仍失败时切回 `Dev Mock` 验证稳定演示主路径。
- Agent 对话未继续追加：结束当前通话，重新选择用例并开始新 session。
- 风险标记不符合预期：切换到 `sensitive-safety` 用例验证敏感规则；如需无效或恶意示例，可在 `src/demoFixtures.ts` 临时新增包含规则关键词的 transcript。
- 播放按钮无声：当前为演示占位静音音频，只用于验证归档和播放控制，不代表真实 RTC 录音。

## 演示后清理

- 停止本地 dev server。
- 不提交 `.env.local` 或任何真实 LiveKit API secret。
- 如为现场演示临时改过 `src/demoFixtures.ts`，演示后恢复为稳定用例。
- 如使用真实 LiveKit room，结束会话后确认 worker 和 dev server 已停止。
