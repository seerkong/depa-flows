# depa-flows DSL Bundle 规范

> 本目录是 depa-flows 流定义 DSL 的权威规范。XNL definition 是可持久化语义真源；代码、编译计划、运行快照和编辑布局都不得反向成为第二份定义。

## 语言与产品

CtrlFlow 是一套共享的 **statements 语法、canonical AST 和编辑投影**，不形成可独立加载的 definition unit。公开控制流产品只有：

- `InstantFlow`：一次即时执行，不允许持久挂起。
- `WorkFlow`：可挂起、快照、恢复和记录已发生决策。
- `BizProcess`：在 WorkFlow 生命周期上增加 TaskSpace 与人工任务事实。

三个产品根的 `[]` 都直接承载有序 CtrlFlow statements。列表顺序本身就是顺序语义，不需要根包装：

```xnl
<InstantFlow #depa.flows.demo.PriceQuote apiVersion="depa.flows/v1" version="1.0.0" [
  <Run #load-quote {
    src = "vfs://./flow-code/quote.ts#loadQuote"
  }>
  <If #route (
    <Branches [
      <Branch #accepted {
        when = "vfs://./flow-code/quote.ts#isAccepted"
      } [
        <Return #accepted-result {
          src = "vfs://./flow-code/quote.ts#acceptedResult"
        }>
      ]>
      <Otherwise [
        <Return #rejected-result {
          src = "vfs://./flow-code/quote.ts#rejectedResult"
        }>
      ]>
    ]>
  )>
]>
```

`EagerDataFlow` 是另一种公开执行产品，根 `[]` 直接承载一次调用内主动求值的 DAG nodes；它不使用 CtrlFlow statements 或其内部计划，也不是长生命周期的 lazy signal DataGraph。

## 产品与制品矩阵

| 产品 | definition 根 | 目录入口 | 根 `[]` | 根 `()` | 跨 unit scheme |
|---|---|---|---|---|---|
| InstantFlow | `<InstantFlow>` | `manifest.xnl` | 有序 CtrlFlow statements | 必需唯一 `FlowContract`，其余可选 | `instant-flow://<FQN>` |
| WorkFlow | `<WorkFlow>` | `manifest.xnl` | 有序 CtrlFlow statements | 必需唯一 `FlowContract`，其余可选 | `work-flow://<FQN>` |
| BizProcess | `<BizProcess>` | `manifest.xnl` | 有序 CtrlFlow statements | 必需唯一 `FlowContract`，其余可选 | `biz-process://<FQN>` |
| EagerDataFlow | `<EagerDataFlow>` | `manifest.xnl` | DAG nodes | `FlowContract` 与可选 `FlowAuthoring` | `eager-data-flow://<FQN>` |

单文件 definition 可使用任意描述性 `.xnl` 文件名；目录 bundle 的入口一律为 `manifest.xnl`。域 facet 的文件名保留点号（例如 `state.def.xnl`、`task.space.xnl`），对应 URI scheme 使用单数 kebab-case（例如 `state-def://`、`task-space://`）。所有产品都遵守 metadata、`{}`、`()`、`[]` 四段职责与 `output = fn(runtime, input, config)` 动态代码协议。

## 三层结构

```text
L1  foundation/        XNL 分段、命名/引用、DEPA 动态代码协议
       ↑
L2  std/behavior-tree/ 内部 BehaviorTreePlan 投影公理
L2  std/instant-flow/  InstantFlow 生命周期 profile
L2  std/work-flow/     WorkFlow 生命周期 profile
L2  std/biz-process/   BizProcess 生命周期 profile
L2  std/eager-data-flow/ EagerDataFlow DAG 执行公理
       ↑
L3  spec/flow-core/    公共 CtrlFlow 文件、statement、引用与代码协议
L3  spec/<profile>/    各产品 capability 与扩展节点
L3  spec/eager-data-flow/ EagerDataFlow contract、node、port 与 subflow
```

遇到未明示的写法，先按 L1 分段与引用公理推导，再由 flow-core 和对应 profile 收窄；不得从实现细节或旧 bundle 反推新语法。

## 阅读顺序

| 层 | 文件 | 回答的问题 |
|---|---|---|
| L1 | [foundation/syntax-axioms.md](foundation/syntax-axioms.md) | `{}`、`()`、`[]` 分别承载什么。 |
| L1 | [foundation/naming-axioms.md](foundation/naming-axioms.md) | 文件、FQN、URI 和 code ref 怎么命名。 |
| L1 | [foundation/depa-axioms.md](foundation/depa-axioms.md) | 动态代码的四边界与函数协议。 |
| L2 | [std/behavior-tree/axioms.md](std/behavior-tree/axioms.md) | authoring AST 如何投影为内部执行计划。 |
| L2 | [std/instant-flow/axioms.md](std/instant-flow/axioms.md) | InstantFlow 的生命周期限制。 |
| L2 | [std/work-flow/axioms.md](std/work-flow/axioms.md) | WorkFlow 的挂起、快照与恢复。 |
| L2 | [std/biz-process/axioms.md](std/biz-process/axioms.md) | BizProcess 的 TaskSpace 与业务结果。 |
| L2 | [std/eager-data-flow/axioms.md](std/eager-data-flow/axioms.md) | EagerDataFlow 的 eager DAG、并发 ready scheduling、错误与 lazy graph 边界。 |
| L3 | [spec/flow-core/nodes.md](spec/flow-core/nodes.md) | 公共 statements 的字段和完整示例。 |
| L3 | [spec/flow-core/orchestration.md](spec/flow-core/orchestration.md) | 公共语义原语、产品 capability 与 FlowContract。 |
| L3 | [spec/flow-core/files.md](spec/flow-core/files.md) | 单文件和目录 bundle 怎么组织。 |
| L3 | [spec/flow-core/refs.md](spec/flow-core/refs.md) | code ref 和 bundle 内引用怎么解析。 |
| L3 | [spec/flow-core/domains.md](spec/flow-core/domains.md) | 哪些事实是定义、派生物或运行态。 |
| L3 | [spec/instant-flow/nodes.md](spec/instant-flow/nodes.md) · [spec/instant-flow/domains.md](spec/instant-flow/domains.md) | InstantFlow statements 与 capability。 |
| L3 | [spec/work-flow/nodes.md](spec/work-flow/nodes.md) · [spec/work-flow/domains.md](spec/work-flow/domains.md) | WorkFlow statements、恢复与持久事实。 |
| L3 | [spec/biz-process/nodes.md](spec/biz-process/nodes.md) · [spec/biz-process/domains.md](spec/biz-process/domains.md) | BizProcess statements、TaskSpace 与事实 owner。 |
| L3 | [spec/eager-data-flow/nodes.md](spec/eager-data-flow/nodes.md) · [spec/eager-data-flow/domains.md](spec/eager-data-flow/domains.md) · [spec/eager-data-flow/files.md](spec/eager-data-flow/files.md) · [spec/eager-data-flow/refs.md](spec/eager-data-flow/refs.md) | EagerDataFlow 根、FlowContract、五种节点、端口、waitFor 与 subflow。 |

## 公共语义速查

- `[]` 是有序 statements；根、分支体、循环体和 fallback strategy 都遵守同一规则。
- `If` 的 `()` 中有且只有一个 `Branches` 子域；`Branches[]` 保存有序 `Branch` 和可选的末尾 `Otherwise`。
- `Branch.when` 与 `Until.when` 是 `vfs://...#Export` predicate code refs，不是在 XNL 中内嵌的表达式。
- `Fallback[]` 按序尝试策略，选择第一个没有技术失败的策略；业务结果始终是数据。
- `Run` 调用代码，其 output 直接成为下一条 statement 的 input；`Return` 立即终止当前 flow 并产生公开 output。
- 所有动态代码遵守 `output = fn(runtime, input, config)`；predicate 只是 output 被约束为 boolean 的同一协议。
- `EagerDataFlow` 的 `flow-port://` 是 data edge，`flow-node://` 是 completion edge；两者共同参与 DAG 校验，所有 ready nodes 可并发调度；`SubFlowNode.flow` 只使用 `eager-data-flow://<FQN>`。

## 事实源

```text
XNL Flow definition
  -> canonical FlowSpec / CtrlFlow AST
  -> internal BehaviorTreePlan
  -> profile engine

XNL EagerDataFlow definition
  -> serializable DAG plan (dataEdges + waitForEdges + subflowEdges)
  -> eager invocation scheduler
```

- XNL definition：唯一 authoring 真源。
- CtrlFlow AST：解析后的规范内存投影，不形成可独立加载的 definition。
- BehaviorTreePlan：编译器可重建的内部执行计划，不得持久化为 authoring definition。
- WorkFlow snapshot：某个运行实例的生命周期状态，不得回写 definition。
- TaskSpace store：人工任务事实源；业务结果作为 data 进入后续 predicate。
- FlowAuthoring：布局与 viewport 真源，不复制 statement topology 或配置。

## Removed Authoring Syntax

以下旧 authoring 入口被明确拒绝，不存在 alias 或兼容解析：

- `Tree` 根或 `tree.xnl` 结构入口。
- 公开 `Sequence`、`Selector`、`Condition` 控制节点。
- `action.types` 类型目录与点分 action tag 注册机制。
- 可执行 `CtrlFlow` 根；它现在只是共享语法/AST 的名称。
- 旧 `DataFlow` 根；数据 DAG 的唯一公开根是 `EagerDataFlow`。

内部 BehaviorTreePlan 可以使用与行为树实现相符的节点 kind，但这些 kind 不属于 XNL authoring surface。
