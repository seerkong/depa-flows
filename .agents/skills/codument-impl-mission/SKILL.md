---
name: codument-impl-mission
description: 执行或续跑 active mission——按 mission.xml 的 DAG，用 MissionPlanner/Observer/Reconciler/Applier 四个控制论 + DEPA actor 观察实际态、执行一个有界动作、允许受控重规划。开始或继续长周期 mission 时使用。
---

# Codument · impl-mission

这是 codument **impl-mission** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/impl-mission.md`

mission.xml 规范见 `@/codument/std/spec/mission-xml-spec.md`；流程块规范见 `@/codument/std/spec/flow-notation.md`。

- **前置**：项目已通过 `codument init` 初始化，目标 mission 已在 `pending/` 或 `active/`。
- **用法**：实现 mission: `<mission-id>`。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/impl-mission.md` 为准。
