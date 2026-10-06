# port-control-graph-logic

纯泛型控制图结构化 processor；契约由 port-control-graph-contract 拥有，SingleEntryGraph 通过 depa-processor/algo 正式消费。没有 XNL、UI、文件系统或 effect 依赖。

`lowerPortControlGraph(runtime, input, config)` 按 entry/enter/next/ordered branches/body/exit 构建 statements 与共享 block 森林。输入保持不变；失败返回带 node/edge identity 的 diagnostics。输出原节点数据仍由 carrier owner 管理。

语义、预算与公开消费示例见仓库 docs/flow-dsl/spec/port-control-graph/index.md。独立 tarball 闭包由 tools/verify-port-control-package.ts 验证。
