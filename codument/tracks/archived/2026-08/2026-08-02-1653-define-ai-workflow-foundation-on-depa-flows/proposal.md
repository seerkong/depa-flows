# Track：define-ai-workflow-foundation-on-depa-flows

## 背景

本仓库已有 WorkCtrlFlow 与 EagerDataFlow 两条底座，但 AI Ctrl Workflow 与 AI Data Workflow 还没有共享的契约层、包边界和 runtime/effect vocabulary。

这个 track 是后续实现 track 的地基：先定义两个 AI workflow profile 如何挂在现有底座上、如何暴露类型、如何注入 wrapper 提供的状态根和 effect provider。

## 目标

- 增加 AI workflow foundation 的 contract/logic 包边界。
- 定义 AI Ctrl Workflow 与 AI Data Workflow 的共享基础类型。
- 明确两个 profile 分别依赖 WorkCtrlFlow 与 EagerDataFlow，而不是另起 flow engine。
- 提供 embedded effect provider、global/workspace roots、resource refs、run identity 与 state store 的类型入口。
- 保持核心逻辑 `output = fn(runtime, input, config)`，副作用只经 runtime contract 注入。

## 非目标

- 不完整实现 AI Ctrl Workflow 调度器。
- 不完整实现 AI Data Workflow RunGraph patch/generation/invalidation。
- 不新增 XNL DSL 文档和示例；这些由后续 docs/examples track 承担。
- 不引入 XML authoring。
- 不硬编码宿主路径或 wrapper runtime 根。
- 不引入外部 CLI 执行 effect provider。

## 影响范围

- 新增或调整 package workspace 边界。
- 新增公开 TypeScript 类型。
- 新增最小 logic helper 或 adapter shell。
- 新增测试或类型检查覆盖，确保包依赖方向可用。

## 成功判据

- 新 foundation 包可以被 workspace typecheck。
- 公开类型表达 AI Ctrl Workflow 基于 WorkCtrlFlow、AI Data Workflow 基于 EagerDataFlow。
- wrapper-provided roots 和 embedded effect provider 都是注入契约，不是硬编码值。
- 受版本管理文件没有绝对路径或外部项目引用。
