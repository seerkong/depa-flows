# Evidence: 跨仓组织任务与工作流机制精简

- P-001 — 2026-11-07 — 规划授权：用户明确要求使用 cdmt-mission-lite 建立四仓精简 mission，先计划确认，不改代码；因此保持 pending。
- P-002 — 2026-11-07 — 已读取 `/Users/kongweixian/.agents/skills/cdmt-mission-lite/SKILL.md`、mission-scaffold、attractor-guidance、attractor-scaffold；按立项返回条件组织文档。
- P-003 — 2026-11-07 — 只读输入：读取既有跨仓 report/manifest；通过 `git rev-parse HEAD`、`git status --porcelain=v1`、package.json scripts 和 `rg --files` 核对仓库、命令与测试入口。观察 flows `97c0428484565a2ad6b703ad31bfa980af8500df` clean；holon `a33dc6e04426206b0b6bdbc49352f6b89f7134e7` clean；anchor `5e54860b02dc2ad0d8ff801850af84c4b2c3b799` dirty 218；bridge `969dd39af9ece4c2be26d5b9850baeabf580d5f6` dirty 132。dirty 是状态条目数量，不是更改字节的冻结证明。
- P-004 — 2026-11-07 — 核实候选测试路径存在：Holon effective-snapshot / organization-snapshot / portable export / timeline；Flow holon-task-target 与持久化测试；Anchor issued-snapshot compatibility / Holon 任务／进程恢复／旧 profile；Bridge launch protocol/controller/bff/authoring、bots wire/reconnect。仅做发现，不表示测试通过。
- P-005 — 2026-11-07 — 项目采集策略：mission 最深 Git 根为 depa-flows.ts；`~/.weaver/config.json` 的 `/Users/kongweixian/infra-dev/**` 排除该根，不调用采集 MCP。文档通过 apply_patch 新增，没有 Bash 产品文件内容变更。

本轮没有产品实现、构建、测试、浏览器操作、npm 发布或 Git 提交／push。后续规划结构核对结果只追加于下，不冒充 active preflight 或业务验收。

- P-006 — 2026-11-07 — 规划结构核对：使用 Python TemporaryDirectory 仅复制本 mission 的 7 份 Markdown 文档，将副本 loop 首个 Status 改为 active，执行 `/Users/kongweixian/.agents/skills/cdmt-mission-lite/scripts/check_mission <temporary>/active/organization-workflow-simplification --phase preflight` — exit 0，输出 mission check passed。副本随后自动清理；实际目录和状态仍为 pending。此项只证明文档具备执行前结构，不代表实际 mission 已授权或业务验收通过。
- P-007 — 2026-11-07 — 校验 7 份文档所有 Markdown 文件链接均可读；检查器已覆盖必要区块、节点字段、目标／约束引用和 Acceptance 覆盖。三组投影、R1—R8 处置、两个吸引子的负向案例人工对照完成。
- P-008 — 2026-11-07 — 写入边界复核：flows 的 tracked 工作区和 index 差异为空，仅新增 `?? .cdmt-lite/`；holon 仍 clean；anchor 状态条目仍 218、bridge 仍 132。本回合写入调用均限定在本 mission 文档，未修改其他仓库文件。没有对这些已有 dirty 字节作未经采集的整仓冻结声明。
- P-009 — 2026-11-07 — 返回条件复核：用户要求仅立项，四个权威载体 MISSION、loop、evidence、Attractors 和设计／验收均完整位于 pending；Next 明确等待用户确认执行。本次满足 skill 的“已立项”返回条件，实施节点仍全部 pending。

- E-001 — 2026-11-07 — 用户确认执行；整目录由 pending 移入 active。四仓 HEAD 与规划基线一致，Anchor/Bridge 既有 dirty 条目数量保持；本轮不覆盖其他工作。

- E-002 — 基线及窄回归：Holon 14 pass/0 fail（4 files），Flow Holon 9 pass/0 fail，Anchor issued snapshot compatibility 2 pass，Bridge 14 pass/0 fail；日志位于 `/private/tmp/organization-workflow-simplification/`。
- E-003 — 入口精简：Holon 私有 encode 路径避免重新 normalize 全图；Flow 删除重复回执比较；Host 提供实际来源/recipient/work 子对象解析，Bridge 删除虚构 start/receipt 和内部 transport 二次解析。Bridge 用实际打包 Host 候选安装后 14 pass/0 fail。
- E-004 — 部署格式：新写入保存共享资源文件，observation 留路径与元信息，Agent 留差异与引用；读取旧完整 bundle 保留。Anchor 部署/恢复/重规划代表回归 5 pass/0 fail（14 filtered），尚待新增明确去重与兼容案例。
- E-005 — 通用 Flow 领域代码及导出已迁至 Anchor/既有 adapter，移除 `holarchy-core-contract` 声明依赖、Holon WeakSet 证明/receipt 两阶段，退役组织专用示例；Flow 当前全套 893 pass/0 fail/98 files，typecheck exit 0。原 9 项领域业务案例迁至 Anchor 待复验，没有把通用包的绿色当成领域验收。

- E-006 — 本轮实际归位验证：Anchor 领域 16 pass/0 fail（4 files），任务服务／适配／独立 OS 进程恢复 12 pass/0 fail（3 files）；部署／运行／恢复选集 6 pass/0 fail。原 Flow 9 项组织业务案例全部迁入 Anchor，新增旧双字段相等兼容与冲突拒绝断言。两项组织专项类型检查 exit 0。日志 `anchor-domain.log`、`anchor-runtime-tests.log`、`anchor-r5.log`；最终源码修改后的复验另记。
- E-007 — 实际候选闭包：六个通用 Flow 包使用 `0.3.0-simplification.0`，既有 adapter/Host/Holon 使用内容命名本地 tgz，A/B 已实际安装，无源码 preload 替代最终消费。最新 Host 元数据解析器及 Holon 合同候选安装后 Bridge 六文件 26 pass/0 fail/214 expects，见 `bridge-final-tests.log`。Anchor 最新安装成功，见 `anchor-final-install.log`。未 publish、push、覆盖已发布制品。
- E-008 — Flow 最终全回归：`bun test` 893 pass/0 fail/98 files，`bun run typecheck` exit 0，`bun run flow-dsl-check` exit 0，11 个现存示例通过。日志 `flows-final-{tests,types,dsl}.log`。pnpm lockfile-only 使用 official registry 重试成功，移除退役 Holarchy 安装项；首次请求停滞已终止，未重复跑大矩阵。
- E-009 — 实施纠偏：迁移脚本一次切分位置错误造成 run-freeze 拼接损坏，另一处替换误删泛型 Agent 调用右括号；已修复后才构建候选、全回归和类型检查通过。旧 fixture 的双摘要曾故意不相等，与真实旧 producer 不符，修为相等正例并保留明确冲突拒绝负例。最终验证未使用失败的 preload 技巧；没有隐瞒这些失败为绿色。

- E-010 — Holon 最终 H2：`bun run build:libraries`、`bun run typecheck` 均 exit 0；组织快照／导出／生效历史／文件 authority 7 文件 28 pass/0 fail。日志 `holon-final-{build,types,tests}.log`。
- E-011 — A2/A4 增强用例最终 6 pass/0 fail/111 expects：两 Agent 共享样本内容只出现 1 次，源码移除后新共享格式和旧 embedded 格式均重开，独立展开 Agent bundle 与部署 Agent 执行计划一致；同定义 Promise 复用，两个 writer 恰一成功，准备后／提交后故障均恢复，无新链记录。见 `anchor-final-storage.log`。
- E-012 — A5 最终业务组 45 pass/0 fail/9 files/521 expects（含真实独立 OS 进程与 launch owner/recovery），adapter typecheck exit 0。简化后 TS 不认可联合 if 后的空值收窄，改为明确缺失状态分支，专项 binding/task 类型检查重新 exit 0。运行存储最后空值改动后的业务复验另记。Bridge B3 最新 typecheck、Vue 与 eidolon 构建 exit 0；大 chunk 提示属现有打包警告，不在本轮扩大优化。
- E-013 — F2：实际在临时独立消费者安装 6 个 tgz 候选，29 包闭包不含 Holarchy、Anchor 或源码符号链接；Ctrl/Data 正常业务 17 pass/0 fail。六包版本均 `0.3.0-simplification.0`，见 `flows-consumer-{install,tests}.log`。该消费者只复制两个测试文件，没有复制仓库／node_modules。
- E-014 — C2 验收执行编排：复用现有真实 HTTP/页面 fixture + 已有真实组织 TaskSpace/进程恢复集成，分别记录覆盖，不新建专用业务替身或证明 gate。默认无 TTY 启动 fixture 遇 stdin EOF 正常清理，providerCalls=0；改用保留 stdin 的 TTY 启动，不改产品行为。

- E-015 — 实际页面验收：Ego 单一隔离 TaskSpace 14，真实 Bridge→Anchor native daemon，选择 `eidolon.fixture.SummaryWorkflow`，主指令→prepare→目录确认→start；原请求 `d53b46da-af78-45e1-9c45-8ea6df3e0fa8` 为 accepted，原运行 `workflow-5ae9e0d714a46a4f720eb43a94de39948471e028` 为 Completed，prepare/done 均 Succeeded，成果页显示原 workflow.runResult。快照 `browser-final.txt`。已 finish({keep:[]})、关闭 fixture，final.json 为 providerCalls=0/cleaned=true。Ego 可用更新仅提示，未升级。
- E-016 — 最终重观察发现并修复旧首次初始化 prepared transaction 无 head 的恢复窗口；6 项存储／恢复测试 112 expects 通过，新增 startup.committed.json 断言。保留旧目录物理边界校验，新格式不创建空旧目录。快照 projector 的剩余重复全图校验改用普通 typed encoder，H2 build/types 与 28 tests 重新通过（见最终 holon-final 日志）。
- E-017 — 最终 H contract/logic tgz 内容分别 `1bba3e5cb592`、`91cd6007bdab`，实际装入 A/B。旧 adapter tgz 的 manifest 仍指向 0.2.2，虽 root override 已命中新代码，仍不足以代表最终包；已重打包为 `3b3536fbbc79`，manifest 与源码统一为 0.3.0-simplification.0 依赖。最终 14 条 A/B 候选映射逐文件核对“源码/构建、tgz、安装、lock”一致。记录 `candidate-resolution.json`。相对 root file override 试验在 Bun workspace 下 ENOENT，恢复本机绝对路径候选，安装成功；未把本机绑定写成跨机器发布结果。
- E-018 — 最终候选前的相关业务组 45 pass、存储组 6 pass，Bridge 六文件加真实 two-hop 为 27 pass/0 fail/302 expects。A adapter/binding/task 三项 typecheck、B types 和当前 eidolon build 全部 exit 0；最终两次 eidolon build 输出主资源文件名一致。当前扩大到被改动的整份 registry 集成测试（19 案例）一次最终验收，防止过滤漏掉其它实际组织调用；不运行无关 provider 矩阵。

- E-019 — C4 清理：删除本 mission 的独立 Flow 消费者（约 27.79 MiB）、已关闭的页面 fixture 目录、临时 tgz、一次性迁移脚本及失败 preload。只保留少量文本日志／初始 diff／候选元数据；当前使用的候选仍在各仓既有 vendor/runtime-artifacts。未清理他人 vendor、缓存、实例或冻结材料。四仓 HEAD 与起点完全一致。

- E-020 — 最终整文件 registry 回归首次 17 pass/2 fail，失败均为两处仍标 v1、却缺少旧格式必需字段的手写 fixture；未删业务案例，将这两处当前 fixture 迁为 v2。额外复查相关合同/Processor/能力/产品路由 fixture：保留两处 v1 读取正例并令双摘要相等，当前 mock 端口改为单字段 v2。最终整文件 **19 pass/0 fail/374 expects**；相关 4 文件 **18 pass/0 fail/103 expects**。日志 `anchor-final-registry-full.log`、`anchor-final-related-contracts.log`。原先过滤组通过不替代本项；本项没有放宽损坏旧字段的校验。
- E-021 — 最终自行独立重观察（未启用额外 agent gap-loop）：重新从用户授权、MISSION 的 8 个期望结果与两个 attractor 重建核对，重读最终源码、实际 tgz/安装闭包与产品面。期望1=H parser/projector/Bridge 去重及 H28/坏输入负例；期望2=Flow 六包无 Holarchy，F2 独立29包/17 tests、Anchor 领域9；期望3=2 Agent/22共享文件/27,955字节/样本1副本，新旧布局脱离源码恢复及单Agent独立展开；期望4=单字段v2、v1一致读取/冲突拒绝/旧任务关联；期望5=定义缓存、双writer/CAS、准备前后与提交后故障、旧无head初始化恢复及会话订阅保持；期望6=Bridge27 tests含真实two-hop、草稿/错响应/unknown不重发；期望7=组织Ctrl/Data TaskSpace/重规划/独立OS进程和真实页面Completed/成果分别覆盖；期望8=result.md逐项R1—R8及测试处置表。没有尚欠验证的实施节点。
- E-022 — 排除集负向检查：AT1：六个Flow manifest、源码和pnpm lock无Holarchy及旧Holon证明类型，独立安装无源码链接；新领域上下文无schema/WeakSet/证明签发；没有新增包或Kind；真实部署样本副本1，不靠改名；没有整仓/node_modules复制。AT2：坏摘要/悬空关系/错任务与HTTP响应、失效revision、旧冲突别名仍拒绝；19项真实组织集成与独立进程恢复保留幂等、终态、会话、订阅及副作用次数；没有用户数据库或真实会话迁移。Provider epoch/session链因有独立消费者按范围外保留，未混同部署外围链。
- E-023 — 最终验收汇总（不把重复执行相加）：Flow893 tests + types + DSL；Holon28 tests + libraries build + types；Anchor registry19、业务/launch/OS45、额外合同/执行器18 tests + adapter/binding/task types；Bridge27 tests + types + current eidolon build；独立Flow候选17 tests；全部命令 exit0。真实页面结果见E-015，最终候选安装代码与源码逐文件一致见E-017。临时目录现约1.6MiB文本，不含消费者依赖、tgz或业务实例。四仓HEAD未改变，无commit/push/publish。最宽已记录相关回归均已过线。

- E-024 — 返回条件核对：独立重观察、每项验收和attractor负向检查均完成，全部节点done，无欠验证项；active目录 `check_mission --phase completion` exit0。按skill已完成返回条件，将整个目录移至archived，非复制第二份。

- E-025 — `check_mission --phase archived` exit0，Status completed与archived目录一致。满足cdmt-mission-lite的已完成返回条件；本轮结束，不以普通阶段进展代替完成。
