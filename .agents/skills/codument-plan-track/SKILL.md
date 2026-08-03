---
name: codument-plan-track
description: 创建 codument 变更追踪（track）——起草 behavior delta + proposal + track.xml（TaskSpace/Schedule/Hooks）。新增能力、破坏性变更、架构/模式调整、改变行为的性能/安全工作时使用；纯 bug 修复/拼写/配置跳过。
---

# Codument · plan-track

这是 codument **plan-track** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/actions/plan-track.md`

按其中的 Markdown 说明 + `--` 流程标记块执行；track.xml 格式见 `@/codument/std/spec/track-xml-spec.md`，提问/确认协议见 `@/codument/std/protocols/questioning.md`（均由 body 按需引用）。

- **前置**：项目已通过 `codument init` 初始化（存在 `@/codument/std/actions/`）；否则先运行 `codument init`。
- **用法**：创建 track: `<track-id>`（动词开头 kebab，如 `add-csv-export`）。

> 壳只做路由，不重述规则。一切以 `@/codument/std/actions/plan-track.md` 为准。
