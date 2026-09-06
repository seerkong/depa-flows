# AI Data workflow · Frozen execution example

[`manifest.xnl`](manifest.xnl) 只声明 `FlowContract` 与唯一 [`StepSpaceRef`](step-space.xnl)，[`steps/`](steps/) 中每个显式引用文件保存一个 node Core，[`flow-code/evidence.ts`](flow-code/evidence.ts) 是 runtime-first node code。Definition 只拥有 DAG topology、ports、code refs 和静态 config，不拥有生成记录或运行结果。

`StepGroup #evidence-processing` 是 authoring ownership，不是 scheduler。Data loader
仍从各 Core 的 `inputs` / `outputs` 投影同一 dependency graph；不存在根据目录、
group nesting 或文字说明推导 edge 的行为。

[`steps/summarize/review-policy.xnl`](steps/summarize/review-policy.xnl) 是一个真实的
schema-bound `StepExtension`。它只由 summarize step 的显式 `ExtensionRef` 进入 definition closure；
host 在 profile runtime 注入 `depa.example.review-policy` 的纯 codec。Instance 冻结 normalized 初始值，
run 的同类事实保存在 canonical checkpoint 的 `stepExtensions` 中；局部 mutation 只新增该 extension
record、所属 leaf 与 Merkle path，不建立第二个 checkpoint authority。

执行前完整 bundle 被录取为 frozen Instance。每个 run 的 canonical `checkpoint.json` 使用 `profile.kind = "AIDataWorkflow"`；RunGraph 的 nodes、generation、patch、invalidation/reuse facts 与 `input/config/state/output`、controller/node sidecars、AI opaque refs 在同一 version transition 中提交。

新的 generation 或 transitive invalidation 不能写回 [`manifest.xnl`](manifest.xnl)，也不能进入平行的 graph-state store。events 和 index 是可重建投影；fresh process 只从 frozen definition 与 checkpoint 恢复。

本示例的普通 `TransformNode` 保持 `output = fn(runtime, input, config)`。`retrieve` 返回稳定 `instance` port；`summarize` 从前驱port构造 exact `{byId}` 并调用同名 bound `runTargetedAgent`。static selector也可用 `{byName}`，但运行输出不得写回Definition config。authored surface没有generic `invoke`或runtime-less shortcut。

物理目录和 CAS 约束见 [Definition、Instance 与 Run](../../../docs/flow-dsl/spec/flow-core/instance-run.md)。
