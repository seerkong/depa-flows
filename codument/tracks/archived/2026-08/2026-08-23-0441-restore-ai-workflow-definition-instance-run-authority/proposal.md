# 变更：恢复 AI Workflow Definition→Instance→Run authority

## 背景和动机

depa-flows 已保留一组重要的 workflow 不变量：`state.def`/`state.seed`/config facets、WorkCtrlFlow snapshot、AIData RunGraph、definition bundle materialization，以及 snapshot 不回写 definition。历史 Python workflow fixture 与 host persistence 进一步证明了完整设计：definition 与 instance 分离，启动时复制完整 bundle；流程级和节点级 input/config/state/output 聚合在 instance；每个 run 在 instance 下持有 checkpoint 和运行证据。

当前实现只完成了其中一部分。filesystem binding 会先从 live definition directory 加载/编译，instance copy 主要服务状态标注；fresh process resume 仍可能读取已修改 definition。`FileWorkCtrlFlowStore` 又把 `<treeId>.snapshot.json` 平铺到调用方目录，Ctrl snapshot、Data RunGraph 和 AI profile state没有被一个 Definition→Instance→Run envelope拥有。Eidolon 随后进一步把这些事实摊平到 `ctrl/`、`ai-state/`、`data-graphs/` 等 sibling roots，形成架构偏差。

本 track 先在真正的领域 owner depa-flows 中恢复 executable store contract。Eidolon 的 legacy migration、typed Agent invocation 和产品 E2E 属于后续 tracks；它们只能消费本 track 的公开 contract，不能先发明 host 私有布局。

## 历史证据蒸馏

本 track 自包含以下已经确认的事实，后续实现不得依赖聊天上下文才能理解：

1. Python multistep fixture 的 process definition显式声明 input/config/state ports；下游 step从上游 step state读取数据。
2. Python host 在创建 instance 时复制 process definition，并为每个 step初始化 config/state/input/output；load/persist 始终围绕 instance directory。
3. Python AI workflow store 在 definition 下创建 instance，instance 下创建 runs；canonical flow store以每个 run的 `checkpoint.json` 做 CAS authority。
4. depa-flows `order-fulfillment` 已声明 state schema、只读 state seed 和 config schema/value；seed作为冻结 instance bundle facet被复制，并在每个新 run checkpoint创建时恰好应用一次，运行态外部保存。
5. depa-flows `materializeInstance` 已能复制完整 bundle，但现有 engine/store还没有让 instance copy和run checkpoint成为唯一恢复入口。
6. 本轮历史参考只采用上述 Python workflow证据与 depa-flows canonical examples；不读取、不引用其他翻译项目。

## 目标

- 定义路径无关的 Definition、Instance、Run 与 checkpoint public contracts。
- 在任何节点执行前把完整 definition artifact冻结为 instance copy，并记录 source revision/digest/provenance。
- 让 start/resume/recovery只从 instance copy编译，不读取 live definition。
- 让每个 `instances/<instanceId>/runs/<runId>/checkpoint.json` 成为该 run 的唯一 live authority。
- checkpoint统一承载 input/config/state/output、controller/node sidecars 与 profile-owned durable state。
- 把 AICtrl WorkCtrl snapshot与 AIData RunGraph收敛为 checkpoint的 typed profile payload，而不是并列可写 store。
- 提供原子、CAS、路径 containment、no-symlink、异常输入和中断恢复健壮性。
- 保留现有 public API的兼容读取路径，但新写入只进入新 authority；不双写。
- 更新 Flow DSL docs与 examples，明确 instance materialization、state seed、profile state和filesystem backend。

## 非目标

- 不实现 Eidolon host roots、旧 WorkflowFactStore迁移或 actor/session runtime。
- 不在本 track实现 `runAgent`/`runTargetedAgent`；但 checkpoint必须提供后续 Agent instance reference state的 typed profile owner位置。
- 不把角色特定 AgentTask加入 generic WorkCtrlFlow grammar。
- 不定义 Halfcode ResourcePackage/Catalog/KindDefinition；definition artifact identity由上游资源/definition loader提供并在物化时核对。
- 不复制 actor conversation/history/compaction到 Flow checkpoint。
- 不创建 `ai-state/<runId>/system.json` 或其他平行 system state store。

## 成功判据

- definition在 instance启动后修改，旧 instance继续按冻结内容运行，新 instance读取新内容。
- fresh process resume只需要 instance id/run id和store root，不需要原 definition directory。
- 每个 run仅有一个versioned checkpoint；Ctrl/Data/profile facts从该 checkpoint读取和恢复。
- `state.seed`是instance冻结bundle中的只读facet；每个新run checkpoint恰好应用一次，instance本身不生成另一份mutable flow state，任何transition都不修改seed或source definition。
- filesystem backend在多 store实例并发下执行CAS，拒绝 unsafe id/symlink/path traversal，并从部分写入中恢复或稳定拒绝。
- derived index/projection删除后可从 canonical instance/checkpoint重建。
- legacy `FileWorkCtrlFlowStore` consumer保持可读或通过显式compat adapter迁移；新engine不对 legacy和新store双写。
- order-fulfillment与AI Ctrl/Data fixtures覆盖definition隔离、多run、profile state和fresh recovery。

## 影响

该变更会新增或调整 flow instance/run contract、WorkCtrl filesystem engine/store和 AI profile integration seam；它是后续 typed Agent invocation、Eidolon persistence migration与产品 E2E的前置 track。
