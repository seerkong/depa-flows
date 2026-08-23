---
name: codument-impl-mission
description: 连续执行或续跑 mission——按 mission.xnl 的 DAG，以操作内验证驱动推进；仅在验证不确定或偏差时观察、收敛和重规划，并在待确认决策、阻塞、终态或十条 track checkpoint 时返回。
---

# Codument · impl-mission

这是 codument **impl-mission** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/impl-mission.md`

mission.xnl 规范见 `@/codument/std/spec/mission-xnl-spec.md`；流程块规范见 `@/codument/std/spec/flow-notation.md`。

- **前置**：项目已通过 `codument init` 初始化，目标 mission 已在 `pending/` 或 `active/`。
- **用法**：实现 mission: `<mission-id>`；pending mission 会直接启动并继续落地。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/impl-mission.md` 为准。
