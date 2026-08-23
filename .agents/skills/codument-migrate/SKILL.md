---
name: codument-migrate
description: 自主升级 Codument workspace 或单资源。无参数时完成整个 workspace 的 CLI 迁移、当前 Agent 语义 review 与全量验证；传入路径时只升级该资源。
---

# Codument · migrate

打开并严格遵循工作区权威 operation：

`@/codument/std/operations/migrate.md`

- **前置**：项目已通过 `codument init` 初始化。
- **无参数**：直接完整升级当前 workspace，不要求用户补充步骤。
- **一个路径参数**：只升级该资源及其必要验证上下文。
- **单资源 CLI**：`codument upgrade-resource <path> --json`。
- **Decision review**：命令对旧 Decision 返回 `review-required` 时，再打开并遵循 [references/decision-migration.md](references/decision-migration.md)。

保持本文件只承担路由。workspace/resource 控制循环以 operation 为准；Decision 的 recovery、conversion、conflict、staging、verification 与旧 authority 退役细则只在 bundled reference 中维护。
