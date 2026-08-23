# Design：typed Agent invocation 与实例选择

## 上下文

当前 depa-flows 已将 Ctrl snapshot、Data RunGraph 与 AI durable state放入单个 `FlowRunCheckpoint`，并将真实 Agent execution留给外部通用 runtime。缺口位于调用协议：author code需要组装 generic `effectId/operation/input/config/run/nodeId` envelope，返回值没有稳定的 instance identity contract，AI profile state也没有可证明唯一的 name index。

本设计把寻址和 invocation 分列，保持 contract ← logic ← host impl 的依赖方向。depa-flows 定义并执行 workflow-domain Processor、checkpoint transition和host effect port；host只实现通用 Agent runtime adapter。runtime是依赖与当前 run/node identity的数据载体，不承载业务方法。

## 方案概览

### 1. Canonical Processor 与 authored facade

底层 public logic只认两个 runtime-first Processor：

```ts
runAgent(agentRuntime, input, config)
runTargetedAgent(agentRuntime, selector, invocation, config)
```

`runAgent` 对应 `output = fn(runtime, input, config)`；`runTargetedAgent` 是 `output = fn(runtime, targets, invocation, config)` 的单目标 specialization。所有层的第二参数统一命名为 `selector`，不得改回 `targets`、`target` 或把 selector塞进 invocation payload。

组合边界可以创建 runtime-bound facade，但方法名保持一致：

```ts
runtime.ai.effects.runAgent(input, config)
runtime.ai.effects.runTargetedAgent(selector, invocation, config)
```

facade只闭包绑定 `agentRuntime` 并调用 canonical Processor。它不能复制 selector解析、checkpoint transition或host dispatch逻辑。existing generic dispatcher可以留在 host/infrastructure compatibility contract中，但 `AIWorkflowAuthoredEffects`、generated flow-code、examples 与 DSL reference不暴露 `invoke`。

### 2. Runtime、config、invocation 与返回值

`AIAgentProcessorRuntime` 是 plain runtime carrier，至少注入：

- 当前 Flow `instanceId/runId/nodeId` 与稳定 `invocationKey`；Data profile还提供 generation，Ctrl profile提供稳定 node invocation identity；
- canonical `FlowRunCheckpointRuntime`；
- host-owned typed Agent execution effect port；
- 可选 cancellation signal和观测 metadata。

这些动态 identity不得重复进入 config。`AIAgentEffectConfig` 只保存静态 authored/frozen facts：exact `agentDefinitionRef`、可选 `instanceName`、material refs与 effect-policy相关 binding。`runTargetedAgent` 接受 immutable `AIAgentInvocation<Input>`，其 semantic type 固定为 Agent invocation且 payload与 metadata保持 closed data。

两条 Processor 都返回：

```ts
interface AIAgentRunResult<Output> {
  readonly output: Output
  readonly instance: {
    readonly authority: string
    readonly instanceId: string
    readonly instanceName?: string
    readonly sessionId?: string
  }
  readonly receipt: {
    readonly invocationKey: string
    readonly nodeId: string
    readonly status: "pending" | "completed"
  }
}
```

具体字段可增加 closed、opaque host receipt，但必须保留 `instance.instanceId` 这一稳定最小 surface。返回对象与持久状态都深度不可变；不得携带 actor object、conversation或history。

### 3. Closed selector 与精确解析

canonical selector是 exact plain-data union：

```ts
type AIAgentSelector =
  | { readonly byInstanceId: string; readonly byInstanceName?: never }
  | { readonly byInstanceName: string; readonly byInstanceId?: never }
```

normalize先验证 own data properties、plain object、闭集字段、Unicode normalization和非空 canonical string，再访问 checkpoint index。以下情况均使用稳定 structured diagnostic fail closed，并且不得调用host effect：

- 同时给出两键、两键都缺失、额外字段或空白值；
- id不存在、name不存在或name重复；
- name→id 与 id index不互相对应；
- resolved instance 的 frozen agent definition与当前 task config冲突；
- selector解析期间checkpoint版本发生冲突且重读后不再得到同一 target。

`runTargetedAgent` 只在成功解析既有 instance后 dispatch；它永不退化为 `runAgent`，也不创建新 Agent instance。

### 4. 单一 profile state owner 与恢复协议

`FlowRunCheckpoint.profile.ai` 是唯一 workflow owner。canonical state以 instance id为主索引，并以 name→id 作可校验辅助索引：

- id index的key必须等于value中的 `instanceId`；
- `instanceName` 可选，但出现时name index必须存在且反向指回同一id；
- 一个name在同一 Flow run内只能对应一个id；同一id不能被两个name声明；
- stored ref只含 authority、instance/session id、agent definition binding与closed opaque metadata；
- invocation receipt以稳定 `invocationKey` 标识 pending/completed transition，并关联node、generation/effect receipt与instance id；
- conversation、history、compaction、actor state和provider transcript均为未知字段并 fail closed。

`runAgent` 先用checkpoint CAS保留 invocation/name intent，再调用带同一 idempotency key的host effect，最后CAS写入instance binding和completed receipt。fresh recovery遇到pending receipt时用相同key向host恢复/查询，不生成第二key。completed receipt直接返回durable result/reference，不重放host child。`runTargetedAgent` 同样先持久化针对已解析instance的invocation intent，再dispatch/恢复并完成回写。

并发name reservation以checkpoint CAS裁决：唯一胜者可dispatch，失败者重读后得到重复名称诊断；不会先创建两个host实例再决定name归属。checkpoint state、Ctrl snapshot或Data RunGraph必须在同一次accepted version transition中共同前进，不允许额外 writable Agent state store。

### 5. AICtrlWorkflow DSL binding

AICtrlWorkflow继续只接受WorkCtrlFlow statement surface。普通 `Run` 节点的 `src` 指向 runtime-first code；Agent resource选择继续由该workflow/node的 exact `AgentTaskRef`/frozen task binding提供，静态 config可声明新实例的 `instanceName` 或 targeted authored selector。

```xnl
<Run #draft {
  src = "vfs://./flow-code/agent.ts#draftWithAgent"
  config = {
    agent = {
      agentDefinitionRef = "resource://depa.examples.Agent.Reviewer"
      instanceName = "requirements-reviewer"
    }
  }
}>
```

后续普通 `Run` 可以在config中给出 `{ byInstanceName = "requirements-reviewer" }`，或从前驱输出取得 `{ byInstanceId = previous.instance.instanceId }` 后传给 `runTargetedAgent`。loader/static proof必须精确绑定node id、workflow ref与agent definition；不得凭node名称、src函数名或拓扑猜语义。不存在新的 `AgentTask` substrate statement。

Ctrl checkpoint将Agent intent/result与WorkCtrl snapshot共同CAS；等待后resume与fresh controller恢复使用相同 invocation key和instance binding。

### 6. AIDataWorkflow DSL binding

AIDataWorkflow继续使用普通 `TransformNode`/`SinkNode` processor。node的 `src` 指向 runtime-first code，`config.agent`声明同一typed task facts。constant selector放在config；data-derived selector通过 `flow-port://` 输入从前驱 `AIAgentRunResult` 取得，不能把运行输出回写definition config。

```xnl
<TransformNode #refine {
  inputs = {
    draft = "flow-port://#draft/result"
    prior = "flow-port://#draft/instance"
  }
  outputs = ["result" "instance"]
  src = "vfs://./flow-code/agent.ts#refineWithAgent"
  config = {
    agent = {
      agentDefinitionRef = "resource://depa.examples.Agent.Reviewer"
    }
  }
}>
```

typed code把 `prior.instanceId` 转成 `{ byInstanceId: prior.instanceId }` 并调用bound `runTargetedAgent`。RunGraph node/generation identity进入 `AIAgentProcessorRuntime`，不进入static config。node Running与Agent pending、node Succeeded与Agent completed必须形成可恢复的accepted checkpoint transition；fresh scheduler恢复accepted output后不重放Agent invocation。

### 7. Compatibility、docs 与生成 reference

- 现有 `AIWorkflowEffectProvider.invoke` 可作为host/infrastructure兼容dispatcher保留并标注非authored；新 `AIWorkflowAuthoredEffects` 不继承它。
- 旧AI profile external ref形状由显式read/upgrade adapter归一化；new commit只接受canonical id/name indexes，不双写两种状态。
- 更新canonical docs、Ctrl/Data examples和Flow DSL checker，再重新生成带source/version/digest provenance的reference module；生成制品不能由手工副本替代。
- 静态测试检查 authored runtime typings与example code没有 `.effects.invoke`，并允许runtime internals继续用受控dispatcher。

## 影响范围与修改点（Impact）

- contracts：Agent Processor runtime、selector、invocation、config、result、instance reference、receipt、authored facade与AI durable state。
- logic：normalizer、selector resolver、checkpoint CAS protocol、host effect adapter、runtime-bound facade factory和legacy state upgrade。
- Ctrl/Data：loader/static binding、runtime adapter、checkpoint integration、recovery tests、examples。
- docs/generated reference：Flow DSL typed Agent invocation章节、Ctrl/Data examples、deterministic regeneration和provenance smoke。

## 决策摘要

- canonical与bound API同名；底层runtime不能被facade设计抹掉。
- selector仅为 `{byInstanceId}`/`{byInstanceName}`，参数名统一为 `selector`。
- Agent ref/index/receipt只写canonical Flow checkpoint AI profile；external runtime保留真实actor/session authority。
- Ctrl/Data复用generic substrate node并通过typed task/config/code表达Agent调用，不新增角色专属node。

## 风险 / 权衡

- checkpoint shape升级可能影响已有消费者 → 用显式legacy reader、canonical write和schema/fixture测试控制，不双写。
- provider完成与checkpoint完成之间存在进程边界 → reservation先行、stable idempotency key和host resume/query effect共同收敛。
- facade可能反向吞掉Processor → 以direct Processor测试、bound facade等价测试和static import scan守住runtime-first surface。
- Ctrl/Data绑定可能被简化成字符串约定 → loader只消费exact typed config/resource tuple，并加入未知/冲突/缺失诊断测试。
- name index并发争用 → checkpoint CAS先裁决reservation，未获胜者不得dispatch。

## 兼容性设计

- generic effect provider仍可服务非Agent host infrastructure，但从authored runtime facade与文档退出。
- legacy AI durable refs仅作输入兼容并一次归一化；canonical types与write path不暴露松散key语义。
- 新增能力保持Halfcode resource identity、AgentTaskRef和run-freeze receipt不变，只增加其runtime execution binding。

## 迁移计划

1. 先用characterization/RED tests冻结现有generic dispatcher、checkpoint和Ctrl/Data recovery行为。
2. 新增closed contract与state normalizer，建立legacy read→canonical state的单向边界。
3. 实现两个Processor和bound facade，接入checkpoint CAS/idempotency协议。
4. 接入Ctrl/Data loader/runtime并更新examples/docs/generated reference。
5. 跑focused、full、typecheck、package/reference smoke和fresh AttractorCheck；发布留给后续mission阶段。

## 待解决问题

- 无。API、selector、state owner与DSL substrate边界已由mission期决策冻结；实现期只允许在不改变这些行为的前提下收紧内部类型与诊断码。
