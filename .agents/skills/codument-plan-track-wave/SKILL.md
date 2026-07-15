---
name: codument-plan-track-wave
description: 规划 track 的并行调度——给某层标 cdt:child-mode="dag" 并在 <Schedule> 写 <Dag> 依赖边（Node/After）。某层直接下层需要并行/DAG 执行时使用。
---

# Codument · plan-track-wave

这是 codument **plan-track-wave** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/plan-track-wave.md`

按其中的 Markdown 说明 + `--` 流程标记块执行；Schedule/DAG 语法见 `@/codument/std/spec/track-xml-spec.md`，调度执行套路见 `@/codument/std/sop/wave-exec.md`（均由 body 按需引用）。

- **前置**：项目已通过 `codument init` 初始化，目标 track 已创建。
- **用法**：规划 track: `<track-id>`。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/plan-track-wave.md` 为准。
