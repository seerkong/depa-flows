# L3 · InstantFlow 事实与域

> 公共 definition、config 与 layout 规则见 [flow-core 事实与域](../flow-core/domains.md)，单文件/目录 bundle 规则见 [flow-core 文件组织](../flow-core/files.md)。InstantFlow 不增加 authoring domain。

## Capability Table

| fact / domain | 状态 | 说明 |
|---|---|---|
| `<InstantFlow>` definition | 启用 | 根 `[]` 直接保存共享 CtrlFlow statements |
| `config` / `config.def` | 可选 | 使用 flow-core 的静态 config 与 shape facet |
| `flow.authoring` | 可选 | 只保存布局，不复制 statements |
| WorkFlow snapshot / WaitHandle / ResumeSignal | 禁用 | InstantFlow 不允许持久挂起或恢复 |
| `state.def` / `state.seed` | 禁用 | InstantFlow 没有跨调用实例状态 |
| `task.space` | 禁用 | 人工任务事实只属于 BizProcess |

单文件是 InstantFlow 的常见发行形态，但目录 bundle 同样合法。两种形态都以产品 definition 为 topology 真源，code ref 都按 `vfs://...#Export` 解析。

## Rejected Authoring Facts

`tree.xnl`、`action.types.xnl`、`Tree` 根、独立 `CtrlFlow` 根以及公开 `Sequence` / `Selector` / `Condition` 都是已移除语法，加载器必须拒绝，不能作为 InstantFlow 兼容入口。
