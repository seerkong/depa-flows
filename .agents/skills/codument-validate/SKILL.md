---
name: codument-validate
description: 校验 track.xml（Track/TaskSpace/Schedule/Hooks/Ports）与 behaviors 登记表结构，支持 --strict 与独立校验子代理模式。提交或归档前做结构/一致性检查时使用。
---

# Codument · validate

这是 codument **validate** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/actions/validate.md`

按其中的 Markdown 说明 + `--` 流程标记块执行；track.xml 校验规则见 `@/codument/std/spec/track-xml-spec.md §9`，behavior 格式见 `@/codument/std/spec/behavior-delta.md`（均由 body 按需引用）。

- **前置**：项目已通过 `codument init` 初始化。外部 `codument` CLI 不可用时 body 会降级为提示词自检并说明。
- **用法**：校验 `<track-id 或 behavior>` [--strict]。

> 壳只做路由，不重述规则。一切以 `@/codument/std/actions/validate.md` 为准。
