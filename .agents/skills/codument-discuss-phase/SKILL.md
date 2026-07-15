---
name: codument-discuss-phase
description: 对已创建 track 的某个 phase 做执行前讨论，细化 TaskSpace、验收、门控、调度和风险，并把稳定知识当轮收敛进 owner 文档。
---

# Codument · discuss-phase

这是 codument **discuss-phase** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/discuss-phase.md`

按其中的 Markdown 说明 + `--` 流程标记块执行；track.xml 格式见 `@/codument/std/spec/track-xml-spec.md`，知识晋升/路由见 `@/codument/std/attractors/knowledge-tiers.md` 与 `model-driven-docs.md`（均由 body 按需引用）。

- **前置**：项目已通过 `codument init` 初始化，且目标 track 已创建。
- **用法**：讨论 track phase: `<track-id>` [phase]（缺省下一个未完成 phase）。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/discuss-phase.md` 为准。
