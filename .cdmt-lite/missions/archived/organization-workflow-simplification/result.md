# 实施结果与兼容边界

本次协调四仓的组织任务精简。没有新增运行期证明包、资源 Kind、认证链或通用存储框架。执行状态及最终验证见 loop.md / evidence.md。

## 机制处置

| 审查项 | 最终处置 | 实际承接位置 |
|---|---|---|
| R1 重复回执解析与 canonical 比较 | 删除；使用资源加载时已经解析的数据及原始字节 | Anchor `organization/WorkflowHolonTask.ts`、`WorkflowRuntimeService.ts` |
| R2 同字节两个回执摘要字段 | 合并；新写入只保留 `issuerReceiptId` | 既有 `holarchy-eidolon-adapter/WorkflowHolonTaskContract.ts` |
| R3 组织全图重复遍历 | 外部输入仍完整解析；parser 编码不再重新 normalize；projector 对规范化后的树直接编码和计算摘要 | Holon 两个 `effective-snapshot.ts` |
| R4 Flow 理解 Holon 并签发两级证明 | 从六个通用 AI Flow 包删除组织 API、依赖和 Holon WeakSet 标记；领域 helpers 归 Anchor，转换返回普通上下文 | Anchor 既有 adapter 与 `ai-organ-logic/src/organization/WorkflowHolonTask*.ts` |
| R5 observation／每个 Agent 重复内嵌资源全集 | 部署格式 2 保存一份共享资源；observation 保存路径，Agent 保存自身信息；独立导出时展开 | Anchor `HolonDeploymentDefinition.ts` |
| R6 每次状态操作重建定义与外围双链 | 实例内复用不可变定义；新正常写入仅当前状态和原子替换所需准备文件 | Anchor `HolonDeploymentRuntimeStore.ts` |
| R7 为验证来源、recipient、work、page 构造假业务对象 | 直接调用已有合同中的子对象解析函数；不构造虚假 start/session/work page | Anchor Host `Schema.ts` / `WorkflowSchema.ts`；Bridge `workflowPersistence.ts` / `botsWire` |
| R8 已明确类型的内部 transport 重复 deep parse | 内部直接传值；HTTP 入口和响应／请求关联检查保留 | Bridge `backend/packages/anchor-support/src/workflowLaunch.ts` |

`encodeHolonEffectiveSnapshotTree` 是接收已规范化树的普通编码函数，输出现有 snapshot 与字节，不签发新证明，不新增格式。unknown 输入的原 canonical / parse API 继续校验。

## 保留的真实用途

- 组织生效历史、`effectiveAt`、选取组织来源版本及有效关系：由 Holon 查询／投影承担。
- run/node/task/command 关联、任务终态、原订阅／会话引用：用于结果归属、重规划和恢复。
- `expectedRevision`、进程锁、同步落盘、原子替换：用于并发和异常退出恢复。
- HTTP／磁盘输入校验、固定采用的资源字节及产物摘要：用于正确读取、传输和脱离开发源码后恢复。
- 通用 Agent 资源加载／冻结及组织执行绑定原有入口：本次没有把一般资源加载与组织历史校验一起删除。
- provider epoch/cache、会话 fork/rewind 的记录链有独立消费者，属于范围外，未借同名摘要字段一起删除。

四仓源码中部署专属 tree/receipt/head/transaction 格式只由旧存储兼容读取器和对应测试使用；没有找到独立历史页面或其它业务读取者。任务业务历史仍由原 TaskSpace／任务 journal 保存，不拿当前状态文件替代任务历史。

## 旧数据与新写入

| 数据 | 读取与恢复 | 新正常写入 |
|---|---|---|
| 任务组织回执 | 读取 `ai-workflow.holon-task-snapshot-receipt/v1` 和 `eidolon.../v1`；两个旧摘要必须相等，转换一次 | `eidolon.holon-task-snapshot-receipt/v2`，无 `issuerReceiptArtifactDigest` |
| 旧部署完整 observation / Agent bundles | 保留读取与幂等 materialize，按实际内容比较，不能因布局不同拒绝旧部署 | observation `format:2`，共享物理资源、Agent 无 files/layers 全集 |
| 旧 runtime head/tree/receipt/transactions | 校验原格式；完成已准备的旧事务，包括首次初始化尚无 head 的窗口 | `current.json`，提交期间使用 `prepared-state.json`，不生成新 tree/receipt 链 |
| 故障与并发 | 失效 revision 拒绝；双 writer 仅一个提交；准备前后及提交后恢复；旧会话／订阅保留 | 同一套任务和状态执行逻辑，不永久双写两套状态机 |

没有读取或改写真实用户部署／数据库，旧文件未批量迁移或删除。旧版程序不能直接读取新布局；回退程序前应使用旧数据备份或增加相应读取支持，不能把“新版能读旧数据”解释为双向格式兼容。

## 公开包迁移

六个通用 Flow 候选包：`ai-workflow-{contract,logic}`、`ai-ctrl-workflow-{contract,logic}`、`ai-data-workflow-{contract,logic}` 使用 **`0.3.0-simplification.0`**。删除公开 Holon API 属于有意的公开面变更，没有按 patch 覆盖已发布版本。

领域类型、profile 和回执 normalizer 改从既有 `holarchy-eidolon-adapter` 导入；任务创建／等待／结果消费 helpers 归 Anchor 私有组织逻辑。Flow 不反向依赖 Anchor，普通消费者无需组织包。已发布旧 Flow 版本保持原状；未知仓外消费者升级到新候选前，需要迁移原 Holon 导入，本次不声称已迁完所有 registry 用户。

Holon contract/logic、Anchor adapter/Host 采用内容命名的本地 tgz 验证，未 publish。A/B 当前 root overrides 指向本机明确候选；Bun workspace 的相对 file override 验证失败后恢复了既有绝对路径做法。这些是本机候选绑定，不能当作跨机器 registry 交付；正式交付时需要另行发布并换成实际版本依赖。

## 测试处置

- 删除 Flow 的旧 Holon 文件及公开导出，退役两个组织专用示例，更新示例清单和发布元数据测试。
- 原 9 项 Holon 业务测试迁入 Anchor 的 `workflow_holon_context.test.ts`；只删除 clone/WeakSet 真实性结构断言，保留错误闭包、错目标、任务关联、等待、结算、重规划及 Data 消费反例。
- 新增旧双摘要一致兼容／冲突拒绝；共享内容实际副本计数；新旧部署脱离源码恢复与独立 Agent 展开；定义缓存、双 writer、准备前后和提交后恢复、旧首次初始化事务恢复。
- 删除只要求新写入仍生成旧链／重复字段的结构断言；保留并发、坏持久输入、HTTP 串线、未知结果不重发和业务副作用次数检查。

## 验证边界

最终测试命令及结果在 evidence.md；没有运行新旧版本性能比较或无关 provider 大矩阵。

真实页面使用隔离 Bridge / Anchor native daemon，完成 prepare、目录确认、启动、Completed 和成果展示；providerCalls=0。组织 TaskSpace 创建、重复请求、结算、重规划、源码移除及进程恢复由真实组织集成／独立 OS 进程测试覆盖；只有模型/provider 可替身。没有声称这次浏览器脚本本身完成了组织重规划。

临时独立 Flow 消费者只安装 29 个包并执行两份 Ctrl/Data 业务测试；无 Holarchy 或仓库源码链接。完成后删除该消费者的依赖目录和隔离业务数据，保留少量文本日志。没有复制整仓或用户实例。

## 本地最终候选

| 包 | 候选版本 | tgz 内容后缀 | 消费仓 |
|---|---|---|---|
| ai-workflow-contract | 0.3.0-simplification.0 | 969c6fc5c2c2 | eidolon-anchor, eidolon-bridge |
| ai-workflow-logic | 0.3.0-simplification.0 | f841067e6c64 | eidolon-anchor |
| ai-ctrl-workflow-contract | 0.3.0-simplification.0 | 84bdd3243d6e | eidolon-anchor |
| ai-ctrl-workflow-logic | 0.3.0-simplification.0 | d99d8154227c | eidolon-anchor |
| ai-data-workflow-contract | 0.3.0-simplification.0 | 9970551211fc | eidolon-anchor |
| ai-data-workflow-logic | 0.3.0-simplification.0 | c427703cf2e5 | eidolon-anchor |
| holarchy-eidolon-adapter | 0.3.0 | 3b3536fbbc79 | eidolon-anchor, eidolon-bridge |
| holarchy-core-contract | 0.3.0 | 1bba3e5cb592 | eidolon-anchor, eidolon-bridge |
| holarchy-core-logic | 0.3.0 | 91cd6007bdab | eidolon-anchor, eidolon-bridge |
| @cell/ai-runtime-host-contract | 0.3.0 | aaea764ece27 | eidolon-bridge |
