# Design：Definition / Instance / Run authority

## 1. 目标不变量

```text
Definition authoring authority
  --materialize once-->
Frozen Instance bundle
  --create one or more-->
Run checkpoint authority
  --projects-->
events / node views / receipts / indexes
```

- Definition只拥有authoring topology、code、schema、config/seed facets和immutable artifact identity。
- Instance拥有definition的冻结副本、source identity与instance metadata；definition后续变化不影响它。
- Run checkpoint拥有该run的live execution facts；projection不得反写它。
- Host选择root/backend并实现support port，但不重新定义domain hierarchy或profile state语义。

## 2. DataTopology 与 owner

| Fact | Semantic role | Authority model | Owner | Transition | Relation |
|---|---|---|---|---|---|
| definition bundle | current authoring authority | versioned artifact | definition/resource loader | publish new revision | materializes instance |
| instance frozen bundle | recovery material + immutable instance input | durable artifact | instance materializer/store | create once | restores runtime definition |
| run checkpoint | current run authority | durable CAS authority | FlowRunStore | create/save expectedVersion | projects evidence/index |
| WorkCtrl snapshot | typed Ctrl profile state | checkpoint-owned value | AICtrl profile reducer | checkpoint transition | contained by checkpoint |
| AIData RunGraph | typed Data profile state | checkpoint-owned value | AIData profile reducer | checkpoint transition | contained by checkpoint |
| events/receipts/node files | historical record / derived observation | append/projection | projector | derive from accepted checkpoint transition | observes checkpoint |
| actor/session execution | external runtime authority | Eidolon actor runtime | host runtime | mailbox/effect lifecycle | checkpoint records stable refs only |

`physical write site != transition entry != authority owner`：support可写多个文件，但只有checkpoint CAS transition能改变run truth。

## 3. Canonical physical projection

路径名是filesystem support的canonical projection；contract不硬编码全局/工作区绝对root：

```text
<storeRoot>/
  definitions/<definitionRevision>/
    artifact.json
    bundle/...

  instances/<instanceId>/
    instance.json
    definition/...
    runs/<runId>/
      checkpoint.json
      events.jsonl                 # optional historical projection
      projections/...              # optional rebuildable views
```

`instance.json`至少绑定instanceId、definitionRevision、definitionDigest、materializedAt和schemaVersion。它不是run state。`checkpoint.json`至少绑定runId、instanceId、definitionRevision、version和profile kind。

definition archive可由调用方已有immutable ResourcePackage artifact满足；无论是否物理保留`definitions/`cache，instance内都必须存在经过digest readback的完整bundle副本，使fresh recovery不依赖live authoring tree。

## 4. Public contract direction

目标contract采用typed profile而不是多个并列store：

```ts
interface FlowRunCheckpoint<ProfileState> {
  readonly schemaVersion: "depa.flow-run-checkpoint/v1"
  readonly runId: string
  readonly instanceId: string
  readonly definitionRevision: string
  readonly version: number
  readonly input: unknown
  readonly config: unknown
  readonly state: unknown
  readonly output: unknown
  readonly controllerSidecars: Readonly<Record<string, unknown>>
  readonly profile: ProfileState
}
```

真实实现必须用当前项目既有JSON value/closed-data types替换示意中的`unknown`，拒绝 accessor、symbol、sparse array、non-finite number和non-plain object；以上代码只冻结字段角色。

Profile是closed union：

- Ctrl profile持有`WorkCtrlFlowSnapshot`及AI profile durable state。
- Data profile持有`AIDataWorkflowRunGraph`及AI profile durable state。
- 非AI WorkCtrlFlow可使用仅含snapshot的profile。

后续 Agent track将在AI profile durable state内增加id/name indexes与opaque runtime refs；本track先冻结owner和版本化扩展边界，禁止另建store。

## 5. Materialization 与执行顺序

start顺序固定：

1. 解析immutable definition artifact与调用方提供的revision/digest。
2. 建完整candidate instance tree，复制manifest/code/state.def/state.seed/config facets与所有本地依赖。
3. 对candidate做path、byte digest、schema与containment readback。
4. 原子admit instance tree；成功前不创建run。
5. 从instance copy加载/编译definition。
6. 每个新run由instance copy的seed/config/input恰好一次初始化checkpoint version 0；instance本身不生成第二份mutable flow state。
7. CAS写入首个checkpoint后才执行第一个node。

resume/recovery从第5步开始，但只读取instance copy与checkpoint。live definition directory不是参数，也不能作为fallback。

## 6. State、seed 与 sidecar

- `state.def`定义state shape；`state.seed`是instance冻结bundle中的只读facet，并作为每个new run checkpoint恰好一次的initialization input。
- 运行state进入checkpoint.state或profile state；seed和frozen bundle永远只读。
- controller/node sidecars按stable node path/owner key进入checkpoint；它们不是任意host map。
- optional node output/state files只作projection，丢失时从checkpoint重建。
- AI Ctrl的wait/resume/decision facts继续归WorkCtrl snapshot；AI Data generation/invalidation facts归RunGraph；它们共享run envelope但不互相复制。

## 7. Store 与filesystem support

Store port至少提供：

- materialize instance with expected definition identity;
- create/load/save checkpoint with expectedVersion CAS;
- read frozen instance artifact;
- enumerate instances/runs throughderived index or canonical traversal;
- rebuild indexes/projections;
- explicit legacy import/read adapter。

Filesystem support必须：

- safe single-segment ids与fixed sibling names；
- directory-fd/no-follow或等价realpath containment；
- same-parent staging + atomic rename + readback；
- lock/CAS跨独立store实例生效；
- canonical JSON、fatal decode与stable code-unit ordering；
- crash marker/journal只用于恢复，不成为第二authority；
- 在任何rename/remove前验证target/staging/backup physical boundary。

## 8. Compatibility 与迁移

本track不删除旧`WorkCtrlFlowStore` shape。兼容策略为additive：

1. 保留legacy reader，明确其flat snapshot只用于legacy run。
2. 新engine path使用instance/run store，不双写legacy file。
3. 提供pure conversion从legacy snapshot生成一个checkpoint candidate；只有target CAS成功后才标记migration complete。
4. Eidolon-specific flat roots的扫描与迁移由后续host track实现，depa只提供typed import boundary。

## 9. 已否决方案

- 只增加目录文档而不改变engine start/resume读取路径。
- 把instance当一个JSON索引，definition bundle与run facts继续放在siblings。
- Ctrl snapshot、Data RunGraph、AI system state分别成为可写authority。
- 在Eidolon先新增`system.json`再等待depa contract追认。
- 把actor conversation/history复制进checkpoint。
- recovery时重新读取或重新执行live definition猜测现场。

## 10. 后续 typed Agent track 的冻结接口

后续track必须建立：

```ts
runAgent(agentRuntime, input, config)
runTargetedAgent(agentRuntime, selector, invocation, config)

type AIAgentSelector =
  | { readonly byInstanceId: string; readonly byInstanceName?: never }
  | { readonly byInstanceName: string; readonly byInstanceId?: never }
```

facade可以绑定runtime但使用同名methods；generic `invoke`仅为internal dispatcher。Agent instance refs只进入本track定义的AI profile state slot。`instanceName`在一个Flow run内唯一；两键同传、缺键、空值、未找到、重复名称或id/name索引冲突必须fail closed，且不得静默创建新实例。该接口不在本track实现，但它是schema扩展和验收设计的硬边界。

## 11. 验证

- boundary baseline先证明现有engine会从live definition编译、flat store不具备instance/run hierarchy。
- definition修改隔离、两个instances/多个runs、fresh process resume。
- Ctrl wait/resume/branch、Data generation/invalidation与profile state均经checkpoint CAS。
- state seed只初始化；frozen source/seed byte-identical。
- concurrent stores、stale version、invalid ids、symlink、path traversal、partial staging、rebuild projections。
- legacy reader/import幂等且新store不双写。
- order-fulfillment与AI Ctrl/Data physical fixtures；full tests、typecheck、docs example check、package smoke、terminal coding AttractorCheck。

## 12. Modeling 状态

本项目`codument/config/modeling.xml`显式`enabled="false"`，因此本track不生成`modeling_deltas/`。本design的DataTopology、public shape和owner表是本轮self-contained target model；未来启用modeling registry时应由归档/后续track提升，不能借disabled状态把结构知识留在聊天中。
