# Issue tracker: Local Markdown

本仓库的 issues 和 PRD 以 markdown 文件形式存放在 `.scratch/` 下。

## 约定

- 每个 feature 一个目录：`.scratch/<feature-slug>/`
- PRD 文件为 `.scratch/<feature-slug>/PRD.md`
- 实现 issue 放在 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号
- triage 状态写在 issue 文件顶部附近的 `Status:` 行中
- 评论和讨论历史追加到文件底部的 `## Comments` 小节

## 当 skill 说“publish to the issue tracker”

在 `.scratch/<feature-slug>/` 下创建新文件，必要时创建目录。

## 当 skill 说“fetch the relevant ticket”

读取用户引用的本地 issue 文件路径。用户通常会直接提供路径或 issue 编号。
