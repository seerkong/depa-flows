# Design: extend-ai-agent-definition-halfcode-composition

## Declarative shape

```xnl
<AIAgentDefinition #example.CodeAgent ... (
  <MessagePrefix [
    <Message #kernel { role = "system" promptKind = "Prompt" promptRef = "resource://example.KernelPrompt" }>
    <MessageSource #workspace { kind = "AgentMessageSource" ref = "resource://example.WorkspaceInstructions" }>
  ]>
  <ContextPipeline { kind = "AgentContextPipeline" ref = "resource://example.StandardContextPipeline" }>
  <ToolRefs [...]>
  <MaterialPortRefs []>
)>
```

`MessagePrefix` 是有序程序，不只是静态数组：

- `Message` 产生恰好一个 provider-neutral message，沿用现有 Prompt/SchemaRef contract。
- `MessageSource` 是 typed resource ref；执行器可按资源 kind 注册 processor，并 splice 0..N messages。
- projection 保留顺序和显式 `#id`，不从普通文本、资源名或 ref 前缀推断行为。

`ContextPipeline` 是一个 typed resource ref 容器。它冻结一份动态代码资源（首版由资源自身的 `Content` 承载代码字节），但不在本包中规定内部步骤；具体 runtime 使用该代码把 canonical history/context facts 编译成动态 message segment。代码字节必须属于该资源 content identity，不能只用一个未入 closure 的宿主文件路径。

## Compatibility

Legacy `<Messages>` 继续投影为只含 `Message` item 的 `messagePrefix`，同时保留 `messages` compatibility view。新式 `<MessagePrefix>` 也把其中静态 `Message` 投影进 `messages` view，供渐进迁移消费者读取；`MessageSource` 不会被静默丢进该 view。

一个 Agent 同时声明 `Messages` 和 `MessagePrefix` 时 fail closed。`ContextPipeline` 对 legacy Agent 可缺省；Eidolon 的新资源模板将显式要求它。

## Contract projections

- `AIAgentMessagePrefixItemProjection`：closed union，`type = "message" | "message-source"`。
- static item 携带现有 `AIAgentMessageProjection` fields；source item 携带 `id + source` typed ref。
- `AIAgentDefinitionProjection.messagePrefix`：完整有序 projection。
- `AIAgentDefinitionProjection.messages`：legacy/static compatibility view。
- `AIAgentDefinitionProjection.contextPipeline?`：typed resource ref。

## Dependency and freeze authority

新增 relation：

- `agent-message-source`
- `agent-context-pipeline`

两类 edge 与现有 prompt/schema/tool/material edge 一起交给 Halfcode `buildResourceDependencySnapshot`。`semanticResourceFingerprint` 记录完整 prefix union、pipeline kind/id 与 closure content digest。这样 downstream runtime 只能执行已投影且已冻结的资源，不需要第二份解析器。

## Diagnostics

- 缺少两个 prefix 容器：`AI_AGENT_MESSAGE_PREFIX_MISSING`
- 同时存在：`AI_AGENT_MESSAGE_PREFIX_CONFLICT`
- 未知 child：`AI_AGENT_MESSAGE_PREFIX_NODE_INVALID`
- 缺失/重复 child id：复用 closed id diagnostics
- MessageSource typed-ref 错误：复用 `AI_RESOURCE_REF_*`
- ContextPipeline tag/kind/ref 错误：复用 typed subdomain diagnostics

## Dirty-tree coordination

`packages/ai-workflow-contract/src/index.ts` 已有另一个 session 的 `AIAgentSelector byId/byName` 修改。本 Track 只在 Agent resource contract 区域添加类型，保留该不相关 hunk并通过 diff review 防止覆盖。

## Verification

- `agent-resource-projection.test.ts`：legacy parity、新式 prefix/pipeline projection、顺序、immutability、fail-closed。
- `run-freeze.test.ts`：closure/fingerprint 对动态资源内容敏感，对 unrelated overlay 稳定。
- package typecheck、focused tests、strict Codument validation、diff check。
