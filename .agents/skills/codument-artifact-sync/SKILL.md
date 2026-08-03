---
name: codument-artifact-sync
description: 把 track 的 output 物料（docs/制品目录）按规则同步到一个或多个目标位置（dry-run/conflict/provenance 策略）。显式 hook 触发或手动同步制品时使用；不隐式触发。
---

# Codument · artifact-sync

这是 codument **artifact-sync** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/actions/artifact-sync.md`

按其中的 Markdown 说明 + `--` 流程标记块执行（解析来源=track output MaterialBundle / 目标根 → 生成或转换 → 按 policy 写）；docs 路由/质量规则见 `@/codument/std/actions/artifact-sync.md` §4.5（body 引用）。

- **前置**：项目已通过 `codument init` 初始化，对应 profile（如 `docs`）已 enabled，且 hook 显式配置或用户手动调用。
- **用法**：同步 artifact: `<artifact>` [track-id]。

> 壳只做路由，不重述规则。一切以 `@/codument/std/actions/artifact-sync.md` 为准。
