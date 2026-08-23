# Mission：establish-ai-agent-and-ai-data-workflows-on-depa-flows

## 背景和动机

当前 flow 库已经有 WorkCtrlFlow 与 EagerDataFlow 两条底座，但面向 AI agent 自主运行、AI data DAG 编排、状态保存恢复、节点级输入输出与可复用执行记录的上层 workflow 还没有成为库内一等能力。

这次目标不是迁入另一套 flow engine，而是在本仓库现有 flow 底座上建立两个新流类型：

- AI Ctrl Workflow：基于 WorkCtrlFlow，承载长时间 AI agent 协作、节点状态、恢复与 effect 注入。
- AI Data Workflow：基于 EagerDataFlow，承载可迭代修改的 DAG、节点输入输出配置、run-local 语义复用、generation 历史与 invalidation。

同时，应用 bundle workspace 的 authoring surface 要使用本仓库既有 XNL bundle/resource 标准，不引入 XML authoring，也不把运行目录、外部参考位置或宿主机器路径写入受版本管理的资源。

## 目标

- 在本仓库建立 AI Ctrl Workflow 与 AI Data Workflow 的契约、逻辑与运行时包边界。
- AI Ctrl Workflow 必须基于现有 WorkCtrlFlow 能力实现，不引入替代 flow engine。
- AI Data Workflow 必须基于现有 EagerDataFlow 能力实现，并一等支持 DAG patch、generation、传递性 invalidation 与 run-local semantic-hash 结果复用。
- 建立 XNL-only 的应用 bundle workspace authoring 模型，符合本仓库 flow-dsl bundle 资源标准。
- 将 effect provider 作为库内可编程嵌入能力，通过 runtime/config 注入，不依赖外部 CLI。
- 全局与 workspace 级 AI workflow 状态位置由封装层传入；库内不硬编码宿主绝对路径，也不固定旧运行目录名。
- 补齐 `docs/flow-dsl` 中两个新流类型的使用说明与 `examples/xnl-bundles` 示例。

## 非目标

- mission 本身不直接改代码、规范或测试；真实落地由后续 track 承担。
- 不使用或复制其他项目的 flow runtime 实现。
- 不在新资源系统中使用 XML authoring。
- 不把绝对路径、外部项目引用或宿主 workspace binding 写入 git 管理内容。
- 不实现 CLI-only 的 effect provider 执行路径。
- 不把 `.sparrow` 目录布局作为新 authoring 或 runtime 根。

## 成功判据

- 所有落地 track 能回指本 mission 的目标与 ignored analysis 中的证据。
- 新增两个流类型具备清晰 contract/logic 边界，并保持现有包依赖方向。
- XNL 文档和示例能通过现有 flow-dsl 检查或相应新增检查。
- AI Ctrl Workflow 可记录并恢复节点执行状态。
- AI Data Workflow 可保存 RunGraph、记录 patch/generation/invalidation，并在 run-local scope 下按节点 reuse policy 复用语义等价结果。
- effect provider 可通过库 API 内嵌执行，并由调用方注入全局/workspace 状态根。
- `bun run typecheck`、`bun test` 与 flow-dsl 校验在相关 track 验收中通过或给出明确兼容性报告。

## 为什么需要 mission 而不是单个 track

这个目标横跨底层 flow 类型设计、资源系统、运行时 effect 注入、状态恢复、文档示例和兼容验证。单个 track 会把证据盘点、架构选择和实现细节揉在一起，难以在执行中按反馈重规划。

本 mission 只负责控制面：拆分期望态 DAG、绑定真实 track、观察执行结果并在必要时重规划。代码、规范、测试和示例的实际变更必须由真实 track 落地。
