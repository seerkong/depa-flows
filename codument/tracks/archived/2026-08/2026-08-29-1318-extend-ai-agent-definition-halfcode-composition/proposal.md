# Track: extend-ai-agent-definition-halfcode-composition

## Goal

让 `AIAgentDefinition` 以一个真实的 Halfcode 组合程序声明稳定消息前缀和动态上下文管线：`MessagePrefix` 支持异构、可 splice 的消息来源，`ContextPipeline` 显式引用动态代码资源；两者都进入统一 projection、依赖闭包和 run-freeze 语义指纹。

## Motivation

现有 `Messages` 只能列出静态 Prompt-backed `Message`，无法表达 workspace 指令、代码生成的 0..N message 或历史/上下文动态拼接。若消费方在 projection/freeze 之后自行解释这些部分，会产生第二份资源语义 authority。

## Scope

- 新增 `MessagePrefix`，其有序 children 支持静态 `Message` 和代码/资源驱动的 `MessageSource`。
- 新增可选 `ContextPipeline` typed ref；新式 Agent 可以显式声明，legacy Agent 继续兼容。
- 将上述节点纳入 closed diagnostics、dependency edges、immutable projection 与 semantic freeze fingerprint。
- 保留 legacy `Messages` 解析；一个 Agent 必须且只能选择 `Messages` 或 `MessagePrefix`。
- 为下游 Eidolon 提供稳定的 contract types，不在 depa-flows 内执行具体消息源或上下文代码。

## Non-goals

- 不定义 Eidolon 的 Conversation、compaction、provider 或 workspace filesystem 行为。
- 不把 ContextPipeline 内部步骤过度声明成 DSL。
- 不修改本工作区中正在进行的 `AIAgentSelector` 迁移语义。

## Success

真实 Halfcode fixture 能投影异构 prefix 与 pipeline；未知 child、双重 prefix、错 kind/缺 ref 均 fail closed；冻结闭包包含全部动态资源，任一资源内容变化都会改变 snapshot/fingerprint，而 unrelated overlay 不改变 semantic fingerprint。
