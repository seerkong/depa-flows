---
name: codument-impl-quick
description: 基于 Codument 知识上下文和项目工程文件快速实现小改动；适用于 bug、测试、局部重构、非破坏性配置修正。不创建 track/mission，发现超出 quick 范围时转建议 plan-track/plan-mission。
---

# Codument · impl-quick

这是 codument **impl-quick** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/impl-quick.md`

按其中的 Markdown 说明 + `--` 流程标记块执行（加载 Codument owner 知识、判断 quick 边界、实现最小变更、运行验证、报告是否有需要沉淀到 modeling/engineering 的长期知识）。

- **前置**：项目已通过 `codument init` 初始化。
- **用法**：快速实现 `<小改动描述>`。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/impl-quick.md` 为准。
