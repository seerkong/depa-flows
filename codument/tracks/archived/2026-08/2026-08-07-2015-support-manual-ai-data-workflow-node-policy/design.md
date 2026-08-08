# 设计

EagerDataFlow 的 `type` 字段保持 legacy implementation binding，不复用为业务 node type。AIDataWorkflow profile 通过已经可序列化、可保留的 node config 声明 `node_type="manual"`。`nodeTypeForEagerNode` 对初始 plan node读取此 config，与 patch node 的 `nodeTypeForPatchNode` 规则对齐。

复用 policy 仍完全由 `resolveAIWorkflowReusePolicy` 决定：未显式 `reuse_policy` 的 manual node得到 `never/node-type-default`；显式 node policy 仍优先。
