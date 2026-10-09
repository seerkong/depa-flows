# 带端口控制流图 authoring profile

> 目录职责 · holds: CtrlFlowGraph 输入、结构化规则、公开 helper 与输出边界 · excludes: DAG 数据流与持久运行快照 · tier: stable · ⬆from: port-ctrl-graph-to-tree mission · ⬇to: DSL authoring 与 package consumers

`CtrlFlowGraph` 是编译为 `InstantCtrlFlow` 的图式定义；不是 EagerDataFlow，也不引入新的执行引擎。首版为单文件 XNL，FlowContract、Nodes、Edges 内联，代码仍可位于 bundle 下的真实文件。

## 输入与端口

```xnl
<CtrlFlowGraph #demo.Route apiVersion="depa.flows/v1" version="1" {
  targetForm = "InstantCtrlFlow"
  entry = "ctrl-node://#route"
} (
  <FlowContract #demo.Route>
  <Nodes [
    <If #route (<Ports [
      <Port #accepted {order=0 when="vfs://./code.ts#accept"}>
      <Port #otherwise {order=1 default=true}>
    ]>)>
    <Run #charge {src="vfs://./code.ts#charge"}>
    <Run #refuse {src="vfs://./code.ts#refuse"}>
    <Return #done>
  ]>
  <Edges [
    <Edge #accepted-charge {from="port://#route/accepted" to="port://#charge/enter"}>
    <Edge #otherwise-refuse {from="port://#route/otherwise" to="port://#refuse/enter"}>
    <Edge #charge-done {from="port://#charge/next" to="port://#done/enter"}>
    <Edge #refuse-done {from="port://#refuse/next" to="port://#done/enter"}>
  ]>
)>
```

- 节点和边 identity 唯一。端口 URI 为 `port://#nodeId/portId`；目的端口只能是 `enter`。同节点对的不同端口边分别保留。
- Run：enter/next；Return：enter，无输出。If：enter/next 和命名 Port；Until：enter/next/body。
- 每个输出端口至多一条边；不隐含 fan-out 或 AND join。多个互斥分支允许汇合到同一 enter。
- `Port.order` 为唯一非负整数，按 order first-true；default 至多一个且排最后，没有 predicate。非 default 的 when/config 进入树的 Branch。
- 无连接的分支 body 为空；无匹配且没有 default 时保留当前值并正常完成该控制块。显式 next 仍会执行。推导必须纳入空分支/无匹配路径，不可凭非空分支猜测 next。
- FlowAuthoring 只保存布局。图标题左 enter、右 next；分支端口在标题下按 order 展示。树继续使用上下 next。

## 结构化与作用域

If.next 是整个控制块的 continuation。未显式连接时，分析所有可达选择路径的最近公共正常 continuation，并将分支截在此节点前。Return 是 flow exit，不冒充普通 next；某条路径自然终止或 Return 时，不把其他路径的后续提升为所有分支的 next。

显式 next 与分支同一边界重合时只执行一次。已连接的各分支具有公共后续、却无法到达声明的 next 时，返回 `next-conflict`，不择一覆盖源图。公共后续只属于部分路径时，编译为主树和共享 block 森林，由相应调用位置执行 RunBlock。

Until 的 body 边进入嵌套 body，body 的自然结束返回 owner 重新检查 predicate；next 边在循环自然完成后执行。body 不是需要显式 back-edge 的物理环。body/next 共享同一个尾部时可提取 block，但每次调用均实际执行，没有缓存。Return/fault 仍取调用侧作用域。

当前节点集合为 Run、If、Until、Return。任意 back-edge、不可约循环、Parallel/Race、显式 Regions、Work/BP/AI 持久 profile 均拒绝，不自动增加 dispatcher 或复制独立子流。

## 公共包与 receipt

```ts
import {SingleEntryGraph} from 'depa-processor/algo';
import {lowerPortControlGraph} from 'port-control-graph-logic';
import {compileCtrlFlowGraph} from 'instant-ctrl-flow-logic/graph';
import {runInstantCtrlFlowSpec} from 'instant-ctrl-flow-logic/browser';
const compiled = compileCtrlFlowGraph(xnl, {baseUri});
await runInstantCtrlFlowSpec(compiled.spec, {input, runtime, resolveCode});
```

泛型 helper 接受 `ControlGraphRuntime<N,ID,Port>` 与 `PortControlGraph<N,ID,Port,EdgeID>`，输出 `StructuredForest` 或节点/边可定位的 diagnostics。它不认识 XNL、Vue、文件系统或业务 effects。SingleEntryGraph 仅用于节点邻接分析；完整 PortEdge 是输入权威，不用 node-pair Set 替代它。预算缺省为 1000 nodes、5000 edges、10000 structural contexts。

具体 adapter 返回实际生成的 source、canonical spec、statement→source-node provenance、inferredNext，以及 `depa.flows/ctrl-graph-receipt/v1`。receipt 含 compiler identity、profile、源文本 SHA-256、输出文本 SHA-256。布局也属于文本 digest；布局变更会使旧 receipt 失效，但不改变控制轨迹。

共享节点在不同 stop-boundary 下具有不同结构上下文；生成的 statement ID 保持全局唯一并通过 provenance 关联原节点。block ID 对同一输入确定，不承诺跨定义修订的持久 checkpoint 身份。修改定义后必须重新编译，不用此 receipt 恢复 Work/BP/AI 运行。

## 可复现现场

- [完全汇合](../../../../examples/xnl-bundles/port-ctrl-graph-diamond/manifest.xnl)
- [三分支部分汇合 → 两棵树](../../../../examples/xnl-bundles/port-ctrl-graph-partial/manifest.xnl)：A/B 经各自 Run 后调用同一共享 block，C 独立 Return。If 无 next，shared/Return 构成第二棵树。
- [嵌套部分汇合](../../../../examples/xnl-bundles/port-ctrl-graph-nested/manifest.xnl)
- [循环体分支与汇合](../../../../examples/xnl-bundles/port-ctrl-graph-loop/manifest.xnl)：Until.body 内按迭代奇偶选择 fast/slow，推导 chooseStep.next=advance；循环结束后 finalize/Return。测试含0/1/3/5次及超限拒绝。

每个 bundle 有真实 flow-code 和独立 verification/generated-tree.xnl、compile-receipt.json。测试加载实际代码并断言轨迹/输出；更新 golden 需显式执行 `bun tools/generate-port-control-fixtures.ts`，测试不会自动改写期望。

```sh
bun run flow-dsl-check examples/xnl-bundles/port-ctrl-graph-{diamond,partial,nested,loop}
bun test packages/port-control-graph-logic packages/instant-ctrl-flow-logic/test
bun tools/verify-port-control-package.ts
```

Blocks/RunBlock 的运行合同见 [flow-core nodes](../flow-core/nodes.md#blocksrunblock)。
