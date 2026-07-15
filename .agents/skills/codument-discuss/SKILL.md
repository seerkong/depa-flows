---
name: codument-discuss
description: 创建 track/mission 前的人机讨论入口；读取 Codument 知识和项目文件后与用户澄清目标、边界和取舍，必要时仅把证据/findings 临时写入 codument/analysis，并收敛到 quick/track/mission/blocked。
---

# Codument · discuss

这是 codument **discuss** 操作的 skill 壳。**权威提示词在工作区** body——打开并**严格遵循**：

`@/codument/std/operations/discuss.md`

按其中的 Markdown 说明 + `--` 流程标记块执行；它会搜集上下文、与用户对话澄清，并输出 `quick|track|mission|blocked` 的下一步建议。

- **前置**：项目已通过 `codument init` 初始化。
- **用法**：讨论 `<尚未确定 quick/track/mission 的需求>`。

> 壳只做路由，不重述规则。一切以 `@/codument/std/operations/discuss.md` 为准。
