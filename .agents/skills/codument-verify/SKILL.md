---
name: codument-verify
description: 独立验证——派 fresh 子代理实际运行（跑测试/启动应用/复现用例）确认 track 验收是否真实达成，只判定不修复，issues-first 输出。实现后做验收确认时使用。
---

# Codument · verify

这是 codument **verify** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/verify.md`

按其中的 Markdown 说明 + `--` 流程标记块执行（Goal-Backward + 三级 Exists/Substantive/Wired + fresh 子代理**实跑**、逐项 PASS/FAIL + 证据）。注意：verify **只判定不修复**（修复属 implement/gap-loop）。

- **前置**：项目已通过 `codument init` 初始化，目标 track 已实现部分/全部。
- **用法**：验证 track: `<track-id>` [phase]。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/verify.md` 为准。
