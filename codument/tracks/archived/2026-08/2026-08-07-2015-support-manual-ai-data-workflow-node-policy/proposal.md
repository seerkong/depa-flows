# 变更：支持 AIDataWorkflow manual node canonical authoring

## 背景

RunGraph 已定义 manual node 默认 `reuse_policy=never`，但 source loader 把节点 `type` 当作代码引用，导致 `type="manual"` 无法通过 canonical XNL validation。初始节点需要与 patch-added node 一致，从 preserved config 识别 `node_type="manual"`。

## 目标

- AIDataWorkflow XNL 可通过 `config = { node_type = "manual" }` 合法声明人工节点。
- RunGraph 初始节点解析为 `nodeType="manual"`，默认 policy 为 `never` 且 source 为 `node-type-default`。
- 文档和示例明确 authoring 方式。
- 发布兼容版本供 host 使用。

## 非目标

- 不改变 EagerDataFlow 的 legacy `type` 代码绑定字段。
- 不引入新的节点 tag 或执行器。

## 影响

- `ai-data-workflow-logic` node type resolution、tests、AIDataWorkflow docs/example、package version。
