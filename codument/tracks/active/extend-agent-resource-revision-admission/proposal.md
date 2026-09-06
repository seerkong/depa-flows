# 反馈驱动的 Agent 资源修订

## 背景

已有 typed select-existing/author-new 与 Halfcode 0.3 原生 publication。当前 selection 仍 create-only，ContextPipeline/MessageSource 仅有 Content 投影；不能接纳已有 Agent 的修订，也不能把资源代码变化绑定到运行身份。

## 目标与非目标

增加 closed revise-existing、native update/CAS/receipt reconciliation；使 Agent 代码 Kind 拥有真实 CodeBinding、声明依赖、冻结执行及旧版本恢复。原有动态创建和选择不退化，旧任务不会隐式切到新资源。

宿主联调调查确认原生 authored publication 与 resolved execution 仍缺 owner 桥接，且分层 composition 不保留 resolved reader 元数据。增加 P3：从 authentic authored layers 和显式完整 reader contexts 派生 execution observation，显式冻结 reader resolution 身份；CAS 仍使用原始文档 authority，不把执行身份冒充文档身份。P2 已有验收不等于该新增路径已完成。

不新增 registry、文件 journal、GoalGraph 或模型诊断框架；Halfcode 持有编译/执行闭包和 publication 协议，宿主负责 source reader、持久存储、效果端口和反馈诊断。本 Track 不构建、安装或发布包、不提交 Git，不修改 node_modules。以用户批准的未提交基线继续，外部开发源绑定仅在临时会话配置中提供。

## 影响

ai-workflow-contract 的 selection/代码 Kind 合同，ai-workflow-logic 的 selection、agent-resource projection 与 run-freeze。旧版 Content reader 保留；新版配方使用新增 spec revision，旧冻结 run 仍使用其原 reader/代码身份。

Mission 以 auto/manual 模式调用；最后 phase 配 fresh GapLoop（verify_round=true）与 DEPA AttractorCheck。Modeling/engineering 当前关闭，不生成空增量。
