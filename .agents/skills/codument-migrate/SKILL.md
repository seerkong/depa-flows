---
name: codument-migrate
description: 迁移旧 codument 资产到新标准——旧 plan.xml→track.xml、Markdown specs→XML behaviors 登记表、旧 archive 目录布局。升级旧 codument 项目到当前标准时使用。
---

# Codument · migrate

这是 codument **migrate** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/migrate.md`

按其中的 Markdown 说明 + `--` 流程标记块执行（统一覆盖：archive 布局迁移 + Markdown specs→XML behaviors 迁移）；目标格式见 `@/codument/std/spec/behavior-registry.md`、`behavior-delta.md`、`track-xml-spec.md`（均由 body 引用）。旧资产保留到 `codument/legacy/`。

- **前置**：项目已通过 `codument init` 初始化。
- **用法**：迁移 `[archive | specs | all]`。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/migrate.md` 为准。
