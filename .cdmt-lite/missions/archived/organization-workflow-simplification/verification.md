# 验收计划

本文件是验收命令目录；实际执行结果和失败纠偏见 evidence.md。现有测试路径已只读核实；新增案例在实施时写进对应仓库的正常测试目录，不把实现或新运行时藏在 mission 下。执行前检查测试是否使用真实外部 provider 或用户目录；有此副作用的用例先改用隔离配置，外部写入不默认授权。

## 规划核对

**P1（规划时执行，历史证据 P-006—P-009）**：检查所有文档链接、必需字段、期望／约束覆盖、节点依赖；核对四仓本次写入路径只有本目录。检查器只支持 active preflight，因此可对仅含本 mission 文档的临时副本改为 active 后运行结构检查；真实目录始终 pending。明确标记“规划结构检查”，不得写成产品 preflight／业务通过。临时副本立即清理。

## Holon：组织入口与兼容字节

**H1（本地，构建写入本仓生成目录；测试使用隔离文件）**：

```sh
bun run --cwd packages/holarchy-core-contract build
bun run --cwd packages/holarchy-core-logic build
bun test packages/holarchy-core-contract/__tests__/effective-snapshot.test.ts packages/holarchy-core-logic/__tests__/organization-snapshot.test.ts packages/holarchy-core-logic/__tests__/portable-snapshot-export.test.ts packages/holarchy-core-logic/__tests__/authority-snapshot-timeline.test.ts
```

扩充案例：合法旧输入与现有字节协议兼容；坏摘要、悬空组织关系和不匹配回执仍拒绝；有效历史时间切换返回正确成员／角色。内部重复遍历的移除通过调用链和一次解析路径复查确认，不造额外证明对象来统计。

**H2（最终相关回归，串行；修正相关代码后复跑）**：`bun run typecheck`；`bun run build:libraries` 后运行 H1 和 `bun test packages/holarchy-file-xnl-support/__tests__/owner.test.ts packages/holarchy-file-xnl-support/__tests__/native-migration.test.ts packages/holarchy-file-xnl-support/__tests__/organization-authority.test.ts`。若实际改到额外包，补该包业务测试；不因只改合同内部就运行全部浏览器性能测试。

## Flows：通用能力、迁移与独立依赖闭包

**F1（本地，隔离临时 TaskSpace 文件）**：`bun test packages/ai-workflow-logic/test/holon-task-target.test.ts` 为迁移前的有效业务基线；组织案例迁入 Anchor 后，在 Anchor 运行等价案例。保留通用任务的幂等、并发、终态和材料校验，旧测试路径被删除后不再假运行它。

合并字段的新增案例：旧双字段相等可读；不相等拒绝；新写入仅一套字段；已有任务、订阅 ID 和重规划关联保持，不产生新任务副作用。

**F2（隔离打包／安装）**：对通用 AI contract / logic / Ctrl / Data 的明确候选包运行 `npm pack`，在临时消费者安装；检查 manifest、安装 lock 和实际模块解析：无 `holarchy-*`、无 Anchor 反向依赖、无 workspace/link 偷渡，通用导入与最小 Ctrl/Data 执行通过。具体包版本先从实际公开面变更确定，不复用已发布版本。候选验证不是正式 npm 发布。

**F3（最终相关回归）**：flows 根执行 `bun test`、`bun run typecheck`、`bun run flow-dsl-check`，串行并保留旧 Windows 文件持久化反例。不重复新旧性能采样。

## Anchor：共享资源、兼容与恢复

**A1（本地，真实组织适配与任务实现，外部 provider 固定替身）**：

```sh
bun test cell/packages/holarchy-eidolon-adapter/tests/issued-snapshot-compatibility.test.ts cell/packages/ai-organ-logic/tests/workflow/holon_task_runtime_service.test.ts cell/packages/ai-organ-logic/tests/workflow/workflow_holon_task_runtime_adapter.test.ts
```

迁移后继续验证创建／等待／结算／重规划；组织行为不退化，通用流程不再理解 Holon 格式。

**A2（新增业务案例，隔离部署目录）**：使用至少 2 个 Agent 和一份共同的、可识别的资源文件。检查所有持久化文件和 JSON/base64 容器，确认共享样本内容只存一次；Agent 指向同一共享内容。将原开发源移出隔离视图后重启，从保留输入恢复；单 Agent 导出另用一个临时消费者验证自包含。记录实际目录字节和内容副本数即可，不建大文档或长时间性能矩阵。

**A3（本地历史读取）**：`bun test cell/packages/ai-organ-logic/tests/workflow/holon_task_profile_compatibility.test.ts cell/packages/ai-organ-logic/tests/workflow/agent_preparation_observation_recovery.test.ts`。补旧部署完整 bundle、旧双字段任务、新共享格式和坏记录案例；恢复读取不得自动重发业务操作。样本来自现有测试或匿名人工构造，不能拷贝真实业务数据。

**A4（进程／故障隔离）**：`bun test cell/packages/ai-organ-logic/tests/workflow/holon_task_os_process_recovery.test.ts`，并在对应存储测试补两个并发 writer、过期 revision、原子提交前后异常退出、旧 runtime 读取、订阅和会话引用保留。检查同部署后续状态操作不重新装载整个资源集合；采用新部署能切换。无故障恢复覆盖不得切换写入格式或删旧链。

**A5（最终相关回归）**：A1—A4 最终改动后重跑；整份 `bun test cell/packages/ai-organ-logic/tests/workflow/holon_execution_binding_registry.test.ts` 覆盖其余受影响组织调用；`bun run --cwd cell/packages/holarchy-eidolon-adapter typecheck`；`bun run --cwd cell/packages/ai-organ-logic typecheck:holon-execution-binding`、`bun run --cwd cell/packages/ai-organ-logic typecheck:holon-task-runtime`；`bun test tests/workflow-workbench/launch-owner.test.ts tests/workflow-workbench/launch-recovery-review.test.ts`。公开包构建及候选消费列入 C1，不启动与组织任务无关的全仓 provider 矩阵。

## Bridge：草稿、传输和未决命令

**B1（本地，存储和 transport 隔离）**：

```sh
bun test tests/bridge-workflows/launch-protocol.test.ts tests/bridge-workflows/bff.test.ts tests/bridge-workflows/authoring-state.test.ts tests/bridge-bots-im/wire.test.ts
```

补畸形网络输入、错 run/request/channel 响应、过期 serverInstanceId；不完整 JSON/XNL 草稿可保存；子对象校验不构造假的 start／receipt／page。

**B2（本地，断线与重复）**：`bun test tests/bridge-workflows/launch-controller.test.ts tests/bridge-bots-im/reconnect.test.ts`。模拟请求已送达但响应丢失，状态必须是 unknown，可查询原命令，不能重新派发；相同 commandId 幂等，不同内容同 ID 冲突。

**B3（最终相关回归）**：B1/B2 最终重跑；`bun run --cwd frontend/packages/eidolon typecheck`。只有改动页面表示或交互时补该页面正常测试和隔离 UI 验收；不调用 `test:all` 运行全部历史参考、无关 provider 和不存在的 terminal/native 产品。

## 跨仓与结构负向验收

**C1（隔离候选消费）**：Holon 组织合同候选 → Anchor 现有适配候选／Host 合同 → Anchor 与 Bridge 消费；Flow 仅消费通用候选。记录实际依赖版本和解析路径，证明目标实现被使用；旧候选、不相关 dirty 和既有锁依赖不能作为“已验证当前版本”的替代。

**C2（最小真实业务验收）**：隔离端口、配置和存储启动真实 Anchor/Bridge；使用测试组织与任务，完成页面启动 → TaskSpace 创建／完成 → 结果展示 → 重复请求 → 重启恢复 → 采用另一生效组织状态重规划。业务服务、存储和模块实际运行，只有模型/provider 可替身。检查任务／副作用次数、历史、原会话绑定及输出一致；不调用用户真实 CLI 会话，不作新旧版本性能对比。执行时采用组合验收：现有隔离页面入口覆盖真实 Bridge→Anchor HTTP、启动／结果展示；现有真实组织任务集成与 OS 进程用例覆盖组织 TaskSpace、重规划、源码移除后恢复和副作用次数。两组使用相同最终候选实现，分别报告覆盖边界，不声称浏览器本身执行了组织任务。复用现有 owner／存储，不为拼成单条 UI 脚本另建测试专用业务 owner。

**C3（清单＋源码与实际产物核对）**：

- AT1 负向：无新增 proof/authority/attestation 通用包、Kind 或新证明链；Flow 的 manifest/安装闭包无 Holarchy，组织语义不藏在通用图层。
- AT1 负向：Agent 正常保存路径不再内嵌多份共享 files；改名不算去重；内部 typed 调用不重新转字节全图解析。
- AT2 负向：旧双字段冲突、错任务／响应、失效 revision、坏持久输入仍拒绝；异常退出或未知状态不重复执行。
- 逐条比对机制处置表和测试删除清单；只断言旧包装的测试删除，有效业务反例仍在。源码搜索是辅证，最终以依赖闭包、内容副本、真实业务与恢复结果为准。

**C4（资源与授权核查）**：检查本次 diff／操作记录仅在四仓授权边界；临时包／消费者目录按清单删除；无整仓复制和用户实例写入；无 publish/push；验收仅报告实际执行结果。命令失败要记录并解释相关性，不能静默跳过或笼统宣布全部绿色。
