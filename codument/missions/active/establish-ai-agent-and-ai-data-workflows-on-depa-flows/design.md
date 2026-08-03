# Mission Design

## 控制目标

desired state 是本仓库中两个新 AI workflow 类型的完整产品化形态：

- AI Ctrl Workflow 是 WorkCtrlFlow 上的专用 workflow profile，负责 AI agent 节点、消息/material 端口、节点状态记录、恢复与 effect 注入。
- AI Data Workflow 是 EagerDataFlow 上的专用 DAG profile，负责 AI 任务中的数据依赖、节点配置、运行状态、patch/generation/invalidation 与 run-local 结果复用。
- 应用 bundle workspace authoring 使用 XNL-only 资源树，接入本仓库 flow-dsl bundle 规范。
- effect provider 是可编程嵌入的 runtime capability，不通过外部 CLI 执行。

actual state 由本仓库代码、测试、flow-dsl 文档、XNL bundle 示例、Codument track 状态与 ignored analysis/reports 投影构成。

## 事实源与边界

- 当前代码、类型和测试是实现行为事实源。
- `docs/flow-dsl` 是 authoring 规范事实源。
- `examples/xnl-bundles` 是可运行/可检查 bundle 形态的示例事实源。
- mission/track 的 `analysis/` 和 `reports/` 可以保存执行期证据、外部参考和路径绑定；受版本管理的 proposal/design/mission/decision 文件不得保存这些信息。
- session workspace binding 只能由执行时上下文提供，不进入持久 mission 或 track 结构。

## Plan vs Track 区分

本 mission 不直接承担实现。它只创建和维护跨 track 的期望 DAG：

- 普通 Task：证据盘点、设计收敛、总体验证、重规划记录。
- 带 `cdt:TrackLink` 的 Task：创建、执行、验证或归档一个真实 track。

后续每个落地 track 必须在自己的 proposal/design/behavior delta 中明确：

- 变更范围。
- 对应的 flow 底座。
- XNL authoring 与 resource ref 约束。
- 状态恢复、复用、effect 注入或文档示例的验收方式。

## 受控重规划

active mission 可以在以下情况下修订 DAG：

- 证据显示某个 track 切片过大，需要拆分。
- 底层 WorkCtrlFlow 或 EagerDataFlow 暴露缺口，需要新增 foundation track。
- XNL bundle 资源系统与现有检查器存在冲突，需要先补 DSL 标准或 validator。
- effect provider 嵌入边界与现有 runtime/config 约定冲突，需要调整依赖方向。
- 用户新增约束或撤销原假设。

每次重规划必须写入 ignored `reports/`，说明 trigger、actual state、desired state diff 与决策原因，并递增 `mission.xml` revision。

## 风险与处理

- 底座污染风险：如果实现开始复用旧 flow runtime，必须立即停止该 track 并重规划到本仓库底座。
- 资源格式漂移风险：如果示例或 docs 出现 XML authoring，必须作为验收失败处理。
- 路径泄漏风险：如果受版本管理文件出现绝对路径或外部项目引用，必须修正并记录到 report。
- 复用语义风险：generation 只表示历史版本，不进入结果复用语义指纹；reuse 由节点定义、有效输入、配置、material revision、effect policy 与模型/工具约束等内容指纹决定。
- 副作用风险：外部副作用节点默认需要更谨慎的 reuse/invalidation 策略；人工处理节点默认不复用。

## 人工介入规则

默认采用 auto/light 的规划策略：本地证据足够时记录假设并推进，不为非阻塞选择等待用户。

需要人工确认的情况：

- 要改变用户已经明确给出的硬约束。
- 要把大范围 destructive migration 纳入 scope。
- 要跨出本仓库进行实际代码写入。
- 要引入新的持久目录、协议或兼容性破坏策略。

## 收口条件

mission 收口前必须至少有一个最终验证节点确认：

- 两个新流类型的契约、逻辑、docs、examples 与测试一致。
- 路径和外部参考未泄漏到受版本管理文件。
- 新资源 authoring 是 XNL-only。
- effect provider 可作为库能力内嵌执行。
