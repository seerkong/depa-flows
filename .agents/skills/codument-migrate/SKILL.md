---
name: codument-migrate
description: 迁移旧 Codument 资产到当前标准，包括旧 archive/track 布局、Markdown specs、历史 decision.md 与旧 Decision XNL。升级旧工作区，或需要执行 archive、specs、decisions、all 任一迁移时使用。
---

# Codument · migrate

打开并严格遵循工作区权威 action：

`@/codument/std/actions/migrate.md`

- **前置**：项目已通过 `codument init` 初始化。
- **用法**：迁移 `[archive | specs | decisions | all]`。
- **路由**：`archive` / `specs` 按 action 对应分支执行；`decisions` / `all` 在 inventory 或写入前，必须再打开并严格遵循 [references/decision-migration.md](references/decision-migration.md)。

保持本文件只承担路由。Decision 的 recovery、conversion、conflict、staging、verification 与 rollback 细则只在 bundled reference 中维护。
