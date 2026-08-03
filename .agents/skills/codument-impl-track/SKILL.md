---
name: codument-impl-track
description: 按 track.xml 的 TaskSpace + Schedule 执行实现——普通任务由 AI 自主选择本地或委派执行，统一验证并回写状态，运行生命周期 hook，支持中断续跑。开始或继续实现已批准的 track 时使用。
---

# Codument · impl-track

这是 codument **impl-track** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/actions/impl-track.md`

按其中的 Markdown 说明 + `--` 流程标记块执行（遍历 phase、层内顺序/DAG 调度、自主选择 local/delegated、统一验证、回写 status、跑 cdt: hook、续跑检测）；方法论见 `@/codument/std/methods/{tdd,dag-execution}.md`（均由 body 按需引用）。

- **前置**：项目已通过 `codument init` 初始化，目标 track 提案已批准。
- **用法**：实现 track: `<track-id>` [phase]（缺省从第一个未完成 phase 起）。

> 壳只做路由，不重述规则。一切以 `@/codument/std/actions/impl-track.md` 为准。
