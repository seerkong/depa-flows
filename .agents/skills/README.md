# Codument agent skill 壳

本目录是 **coding-agent 标准的 skill 壳**集合：每个操作一个目录，内含一份 `SKILL.md`（frontmatter `name`+`description` + 薄壳正文）。**codument 安装时把这些壳复制进对应 coding agent 的 skill 安装目录**（如 `.claude/skills/`）。

壳是**薄壳**：它只声明"何时用"（description 供 agent 路由）+ 指向工作区里**权威的操作 body**——`@/codument/std/operations/<op>.md`，由 agent 打开并遵循。真正的提示词内容、规则、流程都在 `@/codument/std/operations/`（不在壳里），从而：

- 壳随 agent 安装目录走、轻量、可被多种 agent 复用；
- body 随项目工作区（`@/codument/`）走、自包含、可被 `upgrade-workspace` 刷新；
- 不重复、不双源——壳变更频率低，body 是唯一真源。

## 壳 → body 映射

| skill 壳目录 | 指向的 body |
|---|---|
| `codument-impl-quick/` | `@/codument/std/operations/impl-quick.md` |
| `codument-discuss/` | `@/codument/std/operations/discuss.md` |
| `codument-plan-track/` | `@/codument/std/operations/plan-track.md` |
| `codument-maintain-track/` | `@/codument/std/operations/maintain-track.md` |
| `codument-impl-track/` | `@/codument/std/operations/impl-track.md` |
| `codument-gap-loop/` | `@/codument/std/operations/gap-loop.md` |
| `codument-verify/` | `@/codument/std/operations/verify.md` |
| `codument-validate/` | `@/codument/std/operations/validate.md` |
| `codument-archive-track/` | `@/codument/std/operations/archive-track.md` |
| `codument-plan-mission/` | `@/codument/std/operations/plan-mission.md` |
| `codument-impl-mission/` | `@/codument/std/operations/impl-mission.md` |
| `codument-archive-mission/` | `@/codument/std/operations/archive-mission.md` |
| `codument-artifact-sync/` | `@/codument/std/operations/artifact-sync.md` |
| `codument-docs-bootstrap/` | `@/codument/std/operations/docs-bootstrap.md` |
| `codument-migrate/` | `@/codument/std/operations/migrate.md` |

CLI 辅助命令 `codument init` / `codument status` 不再提供 agent skill 壳；它们作为普通 CLI 命令使用。

> `SKILL.md` 采用 Agent Skills 标准：`name`（=目录名，小写连字符）+ `description`（agent 据此决定何时调用）+ 薄壳正文。其它 agent 专属命令格式（codex/opencode/…）由 codument 生成器按 agent 类型从同一 body 派生。
