# Track：define-xnl-ai-workflow-resource-system

## 背景

AI workflow 需要应用 bundle workspace authoring surface，但不能复用旧运行目录布局，也不能引入 XML resource authoring。当前仓库已有 XNL flow bundle 规范，需要在其上补充 AI workflow resource tree 的一等约束。

## 目标

- 定义 AI workflow app bundle 的 XNL-only resource authoring 规则。
- 明确 resource tree 使用显式 catalog 边界，资源身份来自内容声明而不是路径推导。
- 定义允许的 logical ref scheme：`vfs://`、`resource://`、`config://`、`secret://`。
- 在 contract/logic foundation 中补充 AI workflow resource/ref 类型与 containment-safe helper。
- 补充 flow-dsl resource 文档，供后续两个 workflow profile 文档和示例复用。

## 非目标

- 不实现完整 AI Ctrl Workflow 调度器。
- 不实现完整 AI Data Workflow RunGraph。
- 不增加两种 workflow profile 的完整示例；后续 docs/examples track 负责。
- 不使用 XML authoring 作为新资源格式。
- 不把宿主路径或外部项目引用写入受版本管理文件。

## 成功判据

- Contract/logic 暴露 AI workflow resource/ref vocabulary。
- Helper 能拒绝绝对路径、裸相对路径、`..` escape 与未登记 scheme。
- flow-dsl 文档说明 XNL-only app bundle resource tree 规则。
- Typecheck、相关测试和路径卫生检查通过。
