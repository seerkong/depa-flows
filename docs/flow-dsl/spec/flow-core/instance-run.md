# L3 · Definition、Instance 与 Run

> 本文定义有持久生命周期的 Flow 产品共用的物理事实边界。authoring bundle 是 Definition；执行前录取的完整冻结副本是 Instance；一次执行的唯一可变事实是 Run checkpoint。三者不能互相回写。

## 三层事实链

```text
Definition bundle
  --完整复制、逐字节校验、digest/schema/containment readback-->
Frozen Instance
  --从冻结 definition 编译；为每次执行创建 checkpoint v0-->
Run checkpoints v0..n
```

- **Definition** 是可编辑真源。一次 materialization 绑定其 `revision`、全 bundle `sha256` digest 和 provenance。
- **Instance** 在首个节点执行前原子录取。它包含完整 bundle，包括本地 code、资源、`state.def.xnl`、`state.seed.xnl`、`config.def.xnl` 与 `config.xnl`；实例终身只从冻结副本加载和编译。
- **Run** 属于一个 instance。`checkpoint.json` 是该 run 的唯一可变事实；start、resume、分支、等待和 data generation 都以同一 versioned transition 提交。

`checkpoint v0` 必须在任一用户节点开始前通过 `expectedVersion = null` 的 CAS 被接受。对 Ctrl profile，`v0` 保留 `lastTickNo = 0`、空节点结果和未执行游标；一旦首节点运行，后续事实只能出现在 `v1+`。因此全新进程能够仅凭 checkpoint 区分“已录取但尚未执行”与“至少执行过一个 transition”，并从 `v0` 安全继续，而不把一次未确认的节点执行误判为已持久化。

Definition 更新只影响之后创建的 instance。已有 instance 的新 run 和已有 run 的恢复均不得重新读取 live Definition。

## Modular StepSpace definition

Flow root 可以继续在 `[]` 内联 topology，也可以在 `()` 中声明一个精确的
`<StepSpaceRef { src = "step-space.xnl" }>`；两种 topology authority 不能同时存在。
`StepSpace` 只通过显式 `StepRef`、`StepGroupRef` 和 step 内的 `ExtensionRef`
形成闭包，目录名和目录枚举不产生语义成员。所有 ref 都是 bundle-local virtual ref，
不是宿主物理路径；traversal、symbolic link、重复 id、循环引用、未注册 extension
或 schema identity 不匹配均在 instance admission 前关闭失败。extension registration 必须提供
runtime-only 的纯 codec；schema ref 相等本身不足以录取 value。codec 的 normalized closed value
参与 step digest，codec 函数本身不进入 Definition forest 或任何持久化数据。

每个 `Step` 恰好有一个 `Core`，Core 内保存原 profile 的 canonical statement/node。
`StepGroup` 是 definition ownership/authoring hierarchy，不是第二个 scheduler：Ctrl 按
Core hierarchy 投影既有 control tree；Data 的 port、dependency 与 `waitFor` 仍由各
Core node 事实拥有。`DefinitionStepForest` 是冻结定义投影，不能用作 runtime state
index。完整显式闭包及其逐文件 digest 随 bundle 复制进 Instance；live source 的后续
修改或删除不会影响 fresh run/resume。

## Canonical physical projection

存储根由 runtime 显式注入，不从 Definition 路径、当前工作目录或环境变量推导。reference filesystem projection 为：

```text
<support-root>/
  instances/
    <instance-id>/
      instance.json
      definition/
        manifest.xnl
        step-space.xnl              # 使用模块化 topology 时
        steps/<step-id>/step.xnl    # 只由显式 ref 构成闭包
        ...完整 bundle...
      runs/
        <run-id>/
          checkpoint.json                 # root-last current head
          step-space/
            controls/<digest>.json        # immutable binding/control records
            records/<digest>.json         # Ctrl/Data step-local facts
            trees/<digest>.json           # immutable Merkle nodes
            receipts/<version>.json       # head dependency receipt
          legacy-import.receipt.json   # 仅显式旧数据导入后可有
  run-index.json                       # 可删除并从 checkpoint 重建
```

`instance.json` 只保存 path-independent descriptor：`instanceId`、definition `revision/digest/provenance` 与 materialization 时间。它不保存 run state。`definition/` 的路径和 raw bytes 共同参与 digest，录取后保持不变。

Descriptor 与调用方 source identity 都是 exact closed data：authority、artifact ref 和 revision 必须是非空 canonical string，digest 必须是 lowercase SHA-256；额外字段、accessor、symbol、稀疏数组、非有限数字和非 plain object 在创建 candidate 前关闭失败。`instance.json` readback 使用同一 normalizer，不能因 JSON 可解析就接受扩展字段。

`support-root`、`instances/` 和 instance candidate/live 目录同时是物理 authority boundary。materializer 在任何 `mkdir`、copy、descriptor write 或 rename 前都必须用 `lstat` 拒绝已有 symbolic link，核对真实路径仍包含于显式 owner root，并在安全创建后再次 readback。把 `instances/` 指向外部位置不能产生 candidate、instance 或 run，也不能改变外部文件。

公开逻辑 checkpoint 使用 `depa.flow-run-checkpoint/v1` closed public-data envelope：

| 字段 | 所有权 |
|---|---|
| `instanceId`、`runId`、`version` | run identity 与 CAS transition version |
| `definition` | 必须逐字段等于 instance descriptor 的 revision/digest/provenance |
| `input`、`config`、`state`、`output` | 本 run 的公开数据边界；`config` 是本次执行的 effective config，不是 authoring facet 的副本入口 |
| `controllerSidecars` | 等待、决策、游标等 controller 持久事实 |
| `nodeSidecars` | 按稳定 node identity 保存的持久节点事实 |
| `stepExtensions` | 可选的已注册 step extension facts；精确保存 step/kind/schema、单调 revision 与 normalized closed value |
| `profile` | `WorkCtrlFlow`、`AICtrlWorkflow` 或 `AIDataWorkflow` 的 closed typed state |

reference filesystem owner 将该逻辑值无损编码为 `depa.flow-run-checkpoint-head/v1`：head
只保留 instance/run/definition/version、logical digest、root/control projection 与当前
RunStepState Merkle root。AI Data 初始 membership 从 frozen binding declaration order 派生，
后续只由 accepted add/update/remove patch facts 扩展或留下 tombstone；immutable binding 本身
是内容寻址 control record。Ctrl 初始 membership 必须从 materialized instance 的 frozen canonical
binding 读取，definition-owned branch/node/wait/orchestration facts 归入其 definition leaf，只有 accepted
orchestration 中无法归属 frozen step 的 composite/dynamic identity 才产生 runtime leaf。decode 会重新派生
membership、重建 controller/node sidecars，并再次运行完整 public normalizer；读取者看到的仍是原逻辑
checkpoint，而不是 storage head。

`stepExtensions` 不是额外 store。其 logical facts 属于同一个 checkpoint/version；物理上每个
RunStepState leaf 引用一个 core record digest 与精确的 `kind -> extension record digest` map。
初始 extension membership/value 只来自 materialized frozen DefinitionStepForest，codec registry
是 runtime 的长生命周期依赖并不进入 config 或持久化数据。extension transition 使用 targeted
Processor `mutateRunStepExtension(runtime, selector, invocation, config)`；selector 精确包含
`instanceId/runId/stepId/kind`，invocation 使用 expected revision CAS，config 不携带 codec 或路径。
host bootstrap 可以把 Processor runtime 闭包成同名 typed authored facade
`runtime.ai.effects.mutateRunStepExtension(selector, invocation, config)`；它不是 generic operation envelope。
kind/membership/schema 不可变，每次 checkpoint 最多改变一个 extension fact且 revision 恰加一；
终态 checkpoint 不接受 extension 更新。Memory 与 filesystem owner 在 commit/load 时使用相同
frozen-profile + codec admission，unknown kind、invalid/unnormalized value 和直接伪造 state 均关闭失败。

immutable control/step record、tree node 和 receipt 均按 file fsync → rename → exact parent-directory
fsync 录取；首次创建 runs/run/step-space 子目录也会 fsync 其 exact parent。最终 head 使用同一协议且
最后 rename，因此只有 head 指向的完整闭包是 current authority。未被当前 root 引用的历史 material
不会参与读取或改变逻辑事实。

一次 transition 同时提交 envelope、sidecars 和 profile；不存在一个 profile store、一个 snapshot store、再加一个 system-state store 的并列写入。CAS 失败时不得部分接受任一字段。所有 canonical store 共用同一 transition validator：schema、instance/run identity、冻结 definition identity、profile kind、input 与 config 在 `v0` 后不可改写，version 只能递增一。终态 checkpoint 不再接受任何 commit，包括内容相同但 version 增长的 commit；幂等调用必须直接返回已接受的终态版本。

## Definition facets 与 run state

| source facet | frozen instance | new run | resume |
|---|---|---|---|
| `state.def.xnl` | 原字节保留，约束 state shape | 校验初始/演化 state | 继续约束恢复的 state |
| `state.seed.xnl` | 原字节保留，只读 | 恰好应用一次到 checkpoint v0 | 不再应用；从 checkpoint state 恢复 |
| `config.def.xnl` | 原字节保留 | 约束 effective config | 不成为新的配置真源 |
| `config.xnl` | 原字节保留 | 参与创建本 run 的 effective config | 使用 checkpoint 已绑定 config |

同一 instance 的每个新 run 都从同一只读 seed 开始，但之后独立演化。一个 run 的 state 不能污染另一个 run；恢复也不能借重新加载 seed 覆盖已演化 state。

## Typed profile state

- `profile.kind = "WorkCtrlFlow"`：`profile.snapshot` 保存 WorkCtrl snapshot。
- `profile.kind = "AICtrlWorkflow"`：同一 profile 内保存 WorkCtrl snapshot 和 AI durable state；外部 runtime 仅以 opaque identity/receipt 引用。
- `profile.kind = "AIDataWorkflow"`：同一 profile 内保存 RunGraph 的 node、generation、patch、invalidation/reuse 状态和 AI durable state。

Typed profile 不是任意 closed object：Ctrl snapshot 必须完整携带固定 `schemaVersion/treeId/fqn/status`、controller/node collections 与 orchestration facts，且 `treeId` 必须等于 envelope `runId`。每个 open/closed WaitHandle 也使用 exact public shape，绑定同一 `treeId`，并按所在 collection 校验 `Open` 或终态；branch decision、node/wait result、attempt、deadline、lane、winner、cancellation 与 composite 同样逐层使用 exact shape、固定 enum 和 map-key identity/projection。Completed snapshot 不保留 open wait/composite；applied signal 唯一且指向 closed handle。Ctrl envelope 与 snapshot 只有一个真源：`input = snapshot.input`、`state = snapshot.vars`，`controllerSidecars` 精确等于 status/tick/branch/orchestration/wait/signal 投影，`nodeSidecars` 精确等于 `{ nodeResults, waitResults }`。额外字段、accessor、稀疏数组和重复 identity 都关闭失败。

Data RunGraph 的 checkpoint v0 只能是完整 binding 的 generation-zero initial projection：history 为空、初始 node identity/order 精确一致、所有 node 为 Pending，且没有 result/fingerprint/tombstone；generic create 不能把 advanced graph 当作新 run 录取。之后 RunGraph 必须完整携带同一 `runId`、generation、nodes、declaration order、patch/invalidation collections 与 AIData/EagerDataFlow binding；binding 中的初始 node identity 全集在整个 run 中始终存在，remove 只能留下同 generation 的 `Removed` tombstone，重复 remove 关闭失败且不能推进 generation。accepted node 不得消失；binding 和 node 的 order/dependency/port/config/type 等结构事实只有被本次 appended add/update/remove operation 精确声明并与 after projection 一致时才能变化。所有 flow-port input ref 必须解析到已有 source node 的已声明 output port，URI 精确投影 node/port，且 source 同时出现在 `dependsOn`；`dependents` 是 reciprocal projection。nodeType patch 必须同步重算携带相同 nodeType 的 reuse policy。run node 的 ports、dependencies、dependents、reuse policy、result/fingerprint 和 definition binding 的 contract/node/edge collections 都按 public contract 深校验。terminal node 必须携带 result，result output keys 等于节点声明端口；graph invalidation 与 node `invalidatedBy` 是互为逆投影的同一事实。Data envelope 同样是精确互投影：`state = { status, generation }`、controller sidecar 只有 canonical status、node sidecar 对每个声明 node 保存 `{ status, generation }`；仅 Succeeded graph 的 `output` 等于 Return result，其他状态为 `null`。graph 与所有保留 node 的 generation 只能单调增长；patch/invalidation history 保留已接受前缀且 generation 按追加顺序单调，新 fact 必须与当前 graph 和目标 node generation 一致。public patch/invalidation Processor 对早于 graph 或受影响 node 的显式 generation 关闭失败；未发出任何 invalidation fact 时返回 deterministic no-op，不能虚增 generation。同一 node generation 的 terminal result、output 与 fingerprint 不可重写，只有新 generation 能接受新结果。commit、filesystem decode 与 fresh recovery 都使用同一个 closed normalizer，不能接受 `{}`、任意扩展 authority、身份不一致或缺字段的 profile。

Durable Data binding 是 path-independent data。authoring loader 可在内存 plan 中使用 host-local `baseUri` 解析 code，但 checkpoint facade 必须移除它，owner normalizer/decode 也必须拒绝绝对路径、`file:` URI、UNC 或 drive-local URI。稳定 semantic fingerprint 的 map key 顺序使用明确 UTF-16 code-unit comparator，不能依赖 locale。

Ctrl wait/resume/branch 与 Data generation/invalidation 都是 checkpoint transition 的组成部分。它们不是可以独立覆盖 checkpoint 的旁路状态。

历史名称 `AIWorkflowStateStore` 仅保留为 writable legacy/derived compatibility surface；canonical Ctrl/Data facade 只向它暴露只读 projection，并且只通过 `FlowRunCheckpointStore` 写入。它不能和 checkpoint 形成并列 state authority。

## Derived observations and fresh recovery

events、`run-index.json`、status view、editor/runtime overlay 都是 checkpoint 的只读投影。它们可以删除并重建，也可以延迟更新，但不得反向写入 checkpoint 或冻结 definition。runtime output 也不能成为新的 Definition source。

全新进程恢复只需要：

1. 从 `instance.json` 校验 instance identity。
2. 对 `definition/` 做 containment 与 digest readback，并从该副本重新编译。
3. 读取 `runs/<run-id>/checkpoint.json`，校验 instance/run/definition identity。
4. 从 checkpoint 的完整 envelope 与 typed profile 继续 transition。

`run-index.json`、进程内 cache、live Definition 和旧 flat snapshot 均不参与这条恢复 authority chain。

Filesystem CAS lock 与其 recovery barrier 都记录 owner pid、随机 token 和创建时间，并以 inode/token 核对释放。失效 barrier 可由 fresh store 原子接管；恢复过程不能按“先检查、后直接 unlink”的方式删除已经替换的新 owner。

## One-way legacy import

旧 flat WorkCtrl snapshot 只通过显式 reader/import Processor 进入 canonical store。调用方必须提供已冻结 instance/definition authority 和目标 `(instanceId, runId)`；转换时把 legacy snapshot 及 open/closed WaitHandle、handle identity、applied signal 和 durable child owner 中的旧 tree identity 重绑定到目标 `runId`，receipt 保留原 `legacyTreeId`，转换后的完整 checkpoint candidate 仅在 target `expectedVersion` CAS 成功时被接受。后续 fresh resume signal 只能推进该 target run，不能按旧 identity 建立 sibling run。

导入是单向、幂等的：等价 checkpoint 可恢复 completion receipt；冲突 identity 或已有不同 checkpoint 必须关闭失败。旧文件保持逐字节只读，canonical transition 不双写旧格式。`legacy-import.receipt.json` 是 append-only completion evidence，不是 checkpoint authority。

## Processor boundary

所有涉及 runtime、state 或 effect 的组件继续遵守 DEPA runtime-first Processor：

```text
output = fn(runtime, input, config)
output = fn(runtime, selector, invocation, config)
```

StepSpace profile assembly 的 public authority 是
`assembleDefinitionStepProfile(runtime, input, config)`；filesystem root 只存在于
`createFilesystemDefinitionStepProfileRuntime({ rootDir })` adapter，domain input 不携带物理路径。
filesystem checkpoint store 同样通过 runtime adapter + `(runtime, input, config)` factory 组合；
旧 source/root convenience 只作为 compatibility wrapper。

AI Data filesystem runtime 还注入只读 frozen profile authority。它从
`instances/<instance-id>/definition` 装配 frozen binding、StepSpace membership 与 extension descriptors，
在创建 run 目录前 exact 核对 candidate binding，并在 fresh load 时重复核对；缺少 port、错误 profile
或伪造 binding 均不进入 owner mutation。profile loader 的 codec registry 位于 runtime
（assembly runtime 为 `sources + extensionCodecs`，step mutation runtime 为
`steps + extensionCodecs`），普通 config 不保存函数。

Agent invocation沿用同一Definition/Instance/Run authority。canonical Processor为 `runAgent(runtime, input, config)` / `runTargetedAgent(runtime, selector, invocation, config)`；同名bound facade只在组合边界隐去runtime。instance id/name index与pending/completed receipt属于 `checkpoint.profile.ai`，不创建平行store，也不复制actor/session history。

可运行边界证据见 [WorkCtrl materialized engine fixture](../../../../packages/work-ctrl-flow-logic/test/materialized-engine.test.ts) 与 [filesystem checkpoint fixture](../../../../packages/ai-workflow-logic/test/checkpoint-filesystem.test.ts)。前者验证完整本地依赖和 seed bytes，后者验证 canonical path、fresh store 与同一 checkpoint owner。
