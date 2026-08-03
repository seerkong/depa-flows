# Track：integrate-embedded-ai-effect-provider

## 背景

AI workflow foundation 已经定义 `AIWorkflowEffectProvider` 注入契约，但当前只有调用接口，没有库内可直接组合的 embedded provider 基础设施。后续 AI Ctrl Workflow 与 AI Data Workflow 都需要通过同一个内嵌 provider 执行 AI/tool/material effects，而不是封装外部 CLI。

## 目标

- 在 `ai-workflow-contract` 中补齐可序列化的 embedded effect handler / registry / result 契约。
- 在 `ai-workflow-logic` 中实现可编程注册 handler 的 embedded effect provider。
- 保持 global/workspace runtime roots 由 wrapper 注入，核心库不从 cwd/env 推导。
- 支持 handler 存在性检查、缺失 handler 的结构化错误、signal 透传和 material refs 透传。

## 非目标

- 不实现具体 LLM provider。
- 不实现外部 CLI bridge。
- 不实现权限文件系统 adapter；只保留 provider 调用契约和基础 registry。

## 成功判据

- 应用可创建 embedded effect provider 并注册 operation handler。
- `invokeAIWorkflowEffect` 能通过 runtime context 调用 handler。
- 缺失 handler 会抛出稳定错误，不静默执行。
- handler 可观察 run/node/material/config/signal/roots。
- Typecheck、测试和路径卫生通过。
