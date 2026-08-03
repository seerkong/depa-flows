---
name: codument-plan-mission
description: 创建长周期 mission——生成 pending mission 的 mission.xml、proposal.md、design.md，用控制论 + DEPA actor 模型规划跨多个 track 的长期自动化目标。需要规划比 track 更长、可能重规划的任务时使用。
---

# Codument · plan-mission

这是 codument **plan-mission** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/actions/plan-mission.md`

mission.xml 规范见 `@/codument/std/spec/mission-xml-spec.md`；流程块规范见 `@/codument/std/spec/flow-notation.md`。

- **前置**：项目已通过 `codument init` 初始化。
- **用法**：创建 mission: `<mission-id>`。

> 壳只做路由，不重述规则。一切以 `@/codument/std/actions/plan-mission.md` 为准。
