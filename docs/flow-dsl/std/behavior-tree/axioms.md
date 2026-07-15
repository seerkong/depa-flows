# L2 领域公理 · 内部 BehaviorTreePlan

> BehaviorTreePlan 是 CtrlFlow compiler 的内部执行投影，不是 XNL authoring DSL。编号 `BT-*`；继承 L1 全部公理，但不新增公开文件、root、domain、URI 或 statement。

## BT-1 · Definition 是真源，plan 是派生物

控制流数据链固定为：

```text
XNL product definition
  -> canonical FlowSpec / CtrlFlow AST
  -> BehaviorTreePlan
  -> profile engine
```

产品 definition 的根 `[]` 与嵌套 body `[]` 是执行顺序真源。BehaviorTreePlan 必须可由 definition 机械重建，不得被持久化、编辑或加载为另一种 authoring definition。

## BT-2 · 编译映射不泄漏到 authoring

内部 plan 可以复用行为树 engine 的节点 kind；这些名字只存在于 compiler/engine contract：

| public CtrlFlow fact | internal projection |
|---|---|
| 根或 body 的有序 statements | `Sequence` plan node |
| `If` + ordered Branches | `Selector`，每个 Branch 投影为 `Sequence(Condition(predicate), body)`；Otherwise 是末尾无条件 body |
| `Fallback` + ordered Strategy | `Selector`，只按 technical success/failure 选择 |
| `Until.when` + body | `Until` plan node + predicate code leaf + body plan |
| `Run` | code action leaf |
| `Return` | terminal output leaf |

该映射是实现策略，不构成公开语法承诺。compiler 可以替换内部节点形态，只要 CtrlFlow 的 observable semantics 不变。

## BT-3 · 三个维度必须正交

内部 engine 不得再用一个二值结果同时表达业务结果、技术失败和生命周期挂起：

- **data**：`Run` output、TaskStep 的 approved/refused/forwarded 等业务结果；正常作为后续 statement/predicate 的 input。
- **fault**：代码异常、不可恢复 effect 错误、协议错误、循环 guard 超限；驱动 Fallback 或向外传播。
- **suspension**：WorkFlow/BizProcess 的 timer、external job、human task 等等待；由 profile runtime 快照与恢复，不等于 fault。

内部 plan 若使用 `Success` / `Failure` / `Running` 等 engine 状态，adapter 必须保持上述区分：业务 data 不能映射成 Failure，挂起也不能被当成 strategy 失败。

## BT-4 · 条件决策是可观察事实

`Branch.when` 与 `Until.when` 都由动态代码按 `output = fn(runtime, input, config)` 求值。compiler 只能生成调用 predicate 的内部叶子，不得把 predicate 复制成表达式字符串或第二份条件定义。

InstantFlow 可以只在本次执行内持有决策；WorkFlow/BizProcess 对已发生 branch selection 必须记录或快照。恢复时 plan 可以重建，但已发生路径不能因 predicate 重算而变化。

## BT-5 · Fallback 只消费技术结果

Fallback 的内部 Selector 只观察 strategy 是否发生技术 fault：

- strategy 正常返回任意业务 data 都是 technical success，停止 fallback。
- strategy fault 才允许尝试下一项。
- 全部 strategy fault 时向外传播聚合 fault。
- suspension 保持当前 strategy 的执行位置，恢复后继续该 strategy，不得偷换到下一项。

这条约束防止内部行为树常见的 success/failure 组合语义反向污染公开业务语言。

## BT-6 · 运行态归 profile owner

BehaviorTreePlan 只描述可执行结构，不拥有实例真源：

- WorkFlow/BizProcess snapshot 拥有节点位置、等待句柄和已记录决策。
- TaskSpace store 拥有人工任务状态与业务结果。
- editor runtime overlay 只读投影 plan/snapshot 状态，不回写 definition。

plan 节点 path、内部状态枚举和调试 metadata 都是 runtime/compiler 细节，不得出现在 canonical XNL definition 中。

## BT-7 · Authoring Boundary

旧行为树 root、公开组合节点和动作类型目录已从 authoring surface 移除。校验器若在产品 definition 中发现这些结构必须拒绝；只有 compiler 生成的内存 BehaviorTreePlan 能使用内部 kind。
