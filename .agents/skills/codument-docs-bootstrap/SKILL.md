---
name: codument-docs-bootstrap
description: 把现存项目现状一次性总结进 codument/modeling（领域结构）与 codument/engineering（工程知识）XNL registry，并记录不确定项。首次建立长期知识 registry 时使用。
---

# Codument · docs-bootstrap

这是 codument **docs-bootstrap** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/actions/docs-bootstrap.md`

按其中的 Markdown 说明 + `--` 流程标记块执行（盘点→写 modeling→写 engineering→校验 registry→记不确定）；分形与 XNL schema 均由 body 路由。

- **前置**：项目已通过 `codument init` 初始化。docs 同步能力未开也可纯手动跑。
- **用法**：引导 docs: `[scope]`（缺省全项目）。

> 壳只做路由，不重述规则。一切以 `@/codument/std/actions/docs-bootstrap.md` 为准。
