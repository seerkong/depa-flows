---
name: codument-gap-loop
description: 有界目标对比纠偏（双角色：父层编排 + fresh 子代理）——对比实现 vs 目标、写 gap 报告、修复、复检直到 NO_GAP 或耗尽轮数。需要把实现拉回目标、或某 scope 配了 GapLoop 时使用。
---

# Codument · gap-loop

这是 codument **gap-loop** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/gap-loop.md`

⚠️ 本操作是**双角色协议**：读 body 后**第一操作是判定自己是父层编排代理还是本轮 fresh 子代理**，只执行对应章节。完整规程见 `@/codument/std/operations/gap-loop.md`（body 引用）。

- **前置**：项目已通过 `codument init` 初始化，目标 track 已在实现中。
- **用法**：校验 track: `<track-id>` [--phase <id>] [--background <path>]。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/gap-loop.md` 为准。
