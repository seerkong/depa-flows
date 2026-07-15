---
name: codument-revise-track
description: 非线性修订进行中 track 的自身产物——proposal / design / behavior_deltas / track.xml / analysis / decisions。实现中途需要改动 track 提案、计划或规范增量时使用。
---

# Codument · revise-track

这是 codument **revise-track** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/revise-track.md`

按其中的 Markdown 说明 + `--` 流程标记块执行（确认 track、按改动类型路由到对应文件、跑 operation-hooks 的 revise hook；hook 返回 BLOCKED 则不修改）。

- **前置**：项目已通过 `codument init` 初始化，目标 track 已存在。
- **用法**：修订 track: `<track-id>`（说明要改什么）。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/revise-track.md` 为准。
