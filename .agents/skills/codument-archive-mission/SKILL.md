---
name: codument-archive-mission
description: 归档 mission——把 completed/cancelled/superseded mission 移入 codument/missions/archived/YYYY-MM-DD-<mission-id>/，并按配置提升 durable decisions/memory。mission 收口时使用。
---

# Codument · archive-mission

这是 codument **archive-mission** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/archive-mission.md`

mission.xnl 规范见 `@/codument/std/spec/mission-xnl-spec.md`；归档晋升判定见 `@/codument/std/attractors/knowledge-tiers.md`。

- **前置**：项目已通过 `codument init` 初始化，目标 mission 已完成、取消、废弃或被替代。
- **用法**：归档 mission: `<mission-id>`。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/archive-mission.md` 为准。
