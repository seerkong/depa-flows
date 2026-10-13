# Mission: 跨仓组织任务与工作流机制精简

终点: 在保留组织历史、任务执行、结果关联和异常恢复能力的前提下，删除四仓组织任务链中的重复校验、编码、内容副本和同义字段，使通用流程退出组织模型处理；精简以实际减少机制为结果，不建立新的证明框架。

本文件是期望态权威；工作图与执行状态在 [loop.md](loop.md)，证据在 [evidence.md](evidence.md)。具体迁移见 [design.md](design.md)，验收命令与案例见 [verification.md](verification.md)。

## Attractors

| ID | 角色 | 路径 | 管什么 | 约束哪些环节 | 优先级 |
|---|---|---|---|---|---|
| AT1 | 结构 | [attractors/minimal-mechanisms.md](attractors/minimal-mechanisms.md) | 业务职责归位、内容复用、机制净减少 | 计划 / 决策 / 实现 / 校验 | 1 |
| AT2 | 领域 | [attractors/behavior-and-recovery.md](attractors/behavior-and-recovery.md) | 组织历史、任务关联与幂等、持久数据恢复 | 计划 / 决策 / 实现 / 校验 | 1（两维同时满足） |

## Notes

- 每轮加载 `cdmt-mission-lite`。用户于 2026-11-07 确认本计划并授权实施。
- 唯一协调目录在 depa-flows；不在其余三仓复制 mission、工作图或同名验收状态。旧审查作为输入，不取代本 mission。
- 审查输入：`/Users/kongweixian/infra-dev/halfcode/.depa-analysis/holarchy-simplification-2026-11-07/report.md`。关键处置与理由已写入本目录，恢复不依赖旧会话。
- 候选名先比较 `organization-workflow-simplification`、`holon-task-simplification`、`organization-context-deduplication`，选第一个，覆盖组织、任务和 Bridge 边界；已检查没有同名 mission。
- 不启用额外的多 agent gap-loop；完成前按 skill 自行重读目标、真实产品面与最终代码并重新验证。结构检查不是业务验收。
- 交付为四仓源码、兼容读取、隔离消费与产品验证结果。npm publish、Git push、真实实例数据迁移及生产部署需另有明确授权，本 mission 不自动包含这些动作。
- 已发布的 Flow 版本及 Holarchy 版本不可覆盖；新版具体版本号、公开 API 迁移说明在修改公开面前确定，不擅自复用历史版本或按 patch 发布破坏性删除。

### 仓库与协作边界

| 简称 | 仓库绝对路径 | 本次职责 |
|---|---|---|
| flows | `/Users/kongweixian/infra-dev/depa-flows.ts` | 通用任务／Ctrl／Data 流程能力与跨仓协调 |
| holon | `/Users/kongweixian/infra-dev/holon-workbench.ts` | 组织历史、生效关系、组织输入解析与数据格式 |
| anchor | `/Users/kongweixian/ai/eidolon/eidolon-anchor` | 组织适配、部署资源保存、组织任务及恢复 |
| bridge | `/Users/kongweixian/ai/eidolon/eidolon-bridge` | HTTP 边界、页面草稿、请求／结果关联 |

Anchor、Bridge 有大量既有未提交工作。开始执行要重读局部差异、现有任务与测试基线，保留已有工作；其他任务的旧候选、冻结材料和回执不被本 mission 改写。当前用户要求确定本次目标，但不代其他任务审批、不替它们宣称完成。

### 三组投影

**源头库存**：

| 审查项 | 现有载体 | 观察 |
|---|---|---|
| R1、R2 | flows `packages/ai-workflow-logic/src/holon-task.ts` | 回执重复 canonical 比较；两个字段计算同一份字节摘要 |
| R3 | holon `packages/holarchy-core-contract/src/effective-snapshot.ts`、`holarchy-core-logic/src/effective-snapshot.ts` | parse / normalize / canonical / digest 路径反复处理组织全图 |
| R4 | anchor `HolonExecutionBindingProjection.ts`、`HolonDeploymentDefinition.ts`、`WorkflowRuntimeService.ts`，flows Holon helpers | 已解析组织数据在内部转回字节，再次解析、建立专用证明与回执 |
| R5 | anchor `captureHolonDeploymentResources`、`captureFrozenAgentExecution` | observation、Agent bundle、部署文件持久保存同一文件集合 |
| R6 | anchor `HolonDeploymentRuntimeStore.ts` | 状态之外另有 head/tree/receipt/事务记录；每次状态操作重新加载部署定义 |
| R7、R8 | bridge `workflowPersistence.ts`、`botsWire.ts`、`workflowLaunch.ts`、Anchor 路由 | 虚构业务对象借用校验；同一进程内重复解析 |

**需要改造**：

| 处置 | 机制 | 目标 |
|---|---|---|
| 删除 | 调用方再次验证解析器已验证的回执；内部无新输入时的重复全图解析 | 外部入口检查保留，内部复用已解析对象 |
| 删除 | 为校验来源／子对象而构造的 `validate` 启动命令和 `validation` 回执 | 直接共享实际子对象的校验函数 |
| 删除／迁移 | 通用流程包中的 Holon 专用解析、目标冻结证明、组织回执包装及依赖 | 组织能力归 Anchor 现有适配和组织模块；流程只处理通用任务与结果 |
| 合并 | `issuerReceiptId`、`issuerReceiptArtifactDigest` | 新写入保留 `issuerReceiptId` 供现有任务关联复用，旧字段仅由兼容读取处理 |
| 合并 | 部署内多份同一资源集合 | 一份部署共享资源，Agent 记录配置／差异／引用；单独导出才组装完整包 |
| 合并 | 运行状态外围的两条摘要链和同义存储记录 | 优先当前状态＋并发版本＋必要业务记录＋原子提交；实施前验证是否存在独立历史消费者 |
| 保留 | `effectiveAt`、组织生效历史、有效组织关系、所需来源版本 | 由组织模块承担，不在下游逐层重新证明 |
| 保留 | run/node/task/command 关联、幂等、并发检查、任务终态、未知结果不重发 | 在执行／存储入口保留现有职责 |
| 保留 | HTTP／磁盘真实输入边界的校验、需要恢复的固定输入、旧数据读取 | 同一内容可多次跨外部边界，但内部转换不另造证明 |

**最终暴露**：保留组织任务创建、等待、结算、重规划、历史读取和重启恢复；保留 Bridge 的启动／草稿／观察操作。新通用 Flow 包不再暴露 Holon 专属能力或依赖 Holarchy；Anchor 在已有组织模块承接这些调用。已发布旧包继续存在，不能用新包反向依赖 Anchor 保留旧入口。普通 Agent/workflow 资源加载与恢复能力保留；不新增产品入口、资源 Kind 或通用认证／证明协议。

## 期望结果

- 期望-1: 重复 canonical 比较、内部重复解析、虚构业务对象式校验被移除，真实输入边界仍拒绝非法输入。
- 期望-2: 组织输入只由组织模块／适配处理；通用 Flow 的组织专用公开面完成消费者迁移，依赖闭包不再包含 Holarchy。
- 期望-3: 新部署的共享资源内容只保存一份，多个 Agent 引用复用；断开源码后仍可恢复，独立导出仍自包含。
- 期望-4: 相同回执摘要收敛为一个新写入字段；旧任务、旧部署和订阅可读取、查看、继续处理，不删除历史来实现精简。
- 期望-5: 不可变部署定义不在每次状态操作中完整重建；运行存储删除无独立用途的重复链和记录，保留并发、原子性与异常恢复。若发现独立历史需求，先明确最小保留记录并修订方案，不以静默保留整套旧机制或假定可删过关。
- 期望-6: Bridge 的草稿、请求、结果与真实执行行为保持；内部明确类型传递不重复深度解析，网络边界检查不被删除。
- 期望-7: 组织历史查询、任务创建／结算／重规划、重复请求、断线未知和进程重启，通过四仓隔离真实链路验收；只有外部模型／provider 可用固定测试替身。
- 期望-8: 交付逐项删除／合并／保留清单及兼容读取边界；过时结构测试移除，保留对应业务反例；不以新增证明框架代替精简。

## 约束

- 约束-1: 同时满足 AT1、AT2；测试通过但结构仍增加证明层或业务恢复退化，均不算完成。
- 约束-2: 用户确认执行前，仅允许写本 mission 文档和规划校验的临时副本；不修改四仓产品代码、测试代码、依赖锁、业务数据及历史提交。
- 约束-3: 不新增通用 proof/authority/attestation 框架、包装包、Kind 或每对象认证链；默认复用已有适配、任务和存储模块，不重命名旧机制冒充删除。
- 约束-4: 兼容层只读取旧格式、转换一次，新正常写入不双写永久平行体系；清理真实旧数据不在授权内。格式迁移和公开 API 兼容安排须先有明确设计。
- 约束-5: 保留四仓其他改动、模型与表现层分离、组织／任务／Bridge 各自数据归属；不接管其他任务的运行、审批或冻结制品。
- 约束-6: 验证隔离、串行重型构建；不复制整仓或 node_modules，不启动新旧版本大规模性能对比；单个验证超过预期先诊断，不靠反复扩测收尾。临时安装和缓存有清理范围。
- 约束-7: 不覆盖已发布版本，不擅自 publish/push/部署或调用真实 Bot／组织会话；不把隔离候选消费写成正式 registry 交付。
- 约束-8: 旧结构断言不是业务需求；删除固定过时包装、已移除公共入口或重复字段的测试时，必须保留其原本覆盖的有效业务反例，不靠删业务测试或放宽校验制造绿色。

## Acceptance

以下验收均已完成；最终证据 E-020—E-023 与逐项处置见 result.md；命令、环境、副作用和负向案例见 verification.md。缩写 H/F/A/B 指该文档相应命令组。

- [x] 期望-1、约束-1 → H1、F1、B1＋对应源码复查 → 重复路径被删，坏组织数据／回执／请求仍拒绝。
- [x] 期望-2、约束-3、约束-5 → F2、A1、C1 → 普通 Flow 独立安装无 Holarchy；Anchor 完整组织任务链无降级，无新增反向依赖或证明包。
- [x] 期望-3 → A2 → 多 Agent 的共享样本内容在持久部署中仅一份；移走源目录后重启可执行；导出包可独立加载。
- [x] 期望-4、约束-4 → F1、A3 → 旧记录读取、订阅、重规划、结果消费通过；新记录不写重复字段，冲突旧字段不被默默忽略。
- [x] 期望-5 → A4 → 同一部署定义复用；并发拒绝失效更新；故障恢复无半提交；旧 runtime 恢复通过，重复链处置有实际消费者证据。
- [x] 期望-6 → B1、B2 → 未完成草稿保留，畸形网络输入／串线响应拒绝，断线未知不重发。
- [x] 期望-7 → C2＋H2/F3/A5/B3 最终相关回归 → 隔离真实 Bridge→Anchor→任务链及组织历史可重观察，终态和副作用次数一致。
- [x] 期望-8、约束-1、约束-3、约束-8 → C3 → 每项机制有最终处置和代码位置；AT1/AT2 排除集逐条负向核查；旧结构测试移除或改成有效业务断言。
- [x] 约束-2、约束-5 → P1 → 立项时四仓已有文件逐字节不变，仅新增本 mission 文档；保留用户工作。
- [x] 约束-6、约束-7 → C4 → 验证目录无整仓／依赖副本泄漏；无未授权网络副作用、版本覆盖、Git push 或真实数据迁移。

## 范围外

- LLM/provider epoch/cache、会话 fork/rewind、整个 VFS/VCS 或所有 infra 的全面重写；发现相关疑点只记录，不顺手扩张。
- 删除全部快照／摘要／版本／时间字段，删除组织生效历史，取消多进程并发与异常恢复。
- 重做 Holon 组织模型、通用 Agent 资源模型、UI 框架、消息协议或服务端数据库。
- 正式 npm 发布、生产部署、Git push 和对用户实例的批量迁移。
