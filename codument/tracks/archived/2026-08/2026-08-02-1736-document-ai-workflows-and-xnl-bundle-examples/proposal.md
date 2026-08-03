# Track：document-ai-workflows-and-xnl-bundle-examples

## 背景

AI Ctrl Workflow 与 AI Data Workflow 的 contract/runtime 基础已经落地，但 flow-dsl 文档、XNL bundle 示例和检查链路仍只覆盖既有公开产品。使用者需要在同一资源系统和 XNL authoring 标准下看到两个新流类型的写法。

## 目标

- 为 AI Ctrl Workflow 补充 flow-dsl 使用说明。
- 为 AI Data Workflow 补充 flow-dsl 使用说明。
- 在 `examples/xnl-bundles` 中新增两个可检查的 XNL bundle 示例。
- 扩展 flow-dsl-check，使新示例能纳入检查链路。

## 非目标

- 不实现完整 runtime execution CLI。
- 不引入 XML authoring。
- 不改变既有 InstantCtrlFlow、WorkCtrlFlow、BPCtrlFlow 或 EagerDataFlow 示例语义。

## 成功判据

- README 的产品矩阵和阅读顺序包含两个新流类型。
- 新文档说明两种流的 substrate、根结构、runtime roots/effects、状态与复用边界。
- 新示例 bundle 可被 flow-dsl-check 接受。
- Typecheck、测试、bundle check 和路径卫生通过。
