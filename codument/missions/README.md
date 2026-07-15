# codument/missions —— 长周期 mission

> 目录职责 · holds: 跨多个 track 的长周期 mission、mission.xml 状态真源、proposal/design、执行期 evidence/report 外部记忆 · excludes: 单次变更需求(→tracks/<id>/proposal.md)、代码落地状态(→track.xml)、长期 owner 真源(→docs/behaviors/decisions/memory) · tier: 长周期控制面（活层，非行为真源） · from: backlog/用户战略目标/复盘 · to: 多个 tracks

mission 是比 track 跨度更长的任务类型。它用于把战略目标拆成多个 plan 节点和落地 track，并在较长时间内通过控制论反馈循环持续收敛。mission **不替代 track**：真实代码、规范、测试、迁移仍由 track 承担；mission 负责编排、观察、重规划和归档。

## 目录结构

```text
codument/missions/
  README.md

  pending/
    <mission-id>/
      mission.xml
      proposal.md
      design.md
      decisions.md
      decisions/
      memory/
      analysis/     # 默认不进 git
      reports/      # 默认不进 git

  active/
    <mission-id>/
      mission.xml
      proposal.md
      design.md
      decisions.md
      decisions/
      memory/
      analysis/     # 默认不进 git
      reports/      # 默认不进 git

  archived/
    YYYY-MM-DD-<mission-id>/
      mission.xml
      proposal.md
      design.md
      decisions.md
      decisions/
      memory/
      analysis/
      reports/
```

- `pending/`：已规划但未批准 / 未启动。
- `active/`：正在执行；允许基于 evidence 或 human decision 受控重规划。
- `archived/`：完成、取消、废弃或被替代后的 mission。归档目录名必须使用 `YYYY-MM-DD-<mission-id>` 前缀。

## 标准制品

新 mission 的标准制品是三件套：

- `mission.xml`：唯一结构 / 状态 / 调度真源。它与 `track.xml` 同构，但根为 `<Mission>`，顶层默认 DAG。顶层 `TaskGroup` 可 DAG 调度；组内 leaf `Task` 默认按 `order` 顺序执行。
- `proposal.md`：为什么要做、目标 / 非目标、成功判据、为什么这是 mission 而不是单个 track。
- `design.md`：控制论 + DEPA actor 模型、执行协议、重规划规则、人工介入规则、风险与迁移。

`cdt:TrackLink` 只挂在 leaf `Task` 上，用 `state="candidate|bound"` + `id` 记录推荐或真实 track id；不写 path/archive-path，active/archive 位置从真实 track id 推导。

新 mission **不创建 `roadmap.md`**。旧 roadmap 内容按职责拆分：

| 原路线内容 | 新落点 |
|---|---|
| mission 目标、Non-Goals、成功判据 | `proposal.md` |
| 阶段路线、节点依赖、状态、TrackLink candidate/bound | `mission.xml` |
| plan vs track 区分规则 | `design.md` |
| 当前判断、阻塞、风险 | `design.md` + `mission.xml` 状态 |
| 证据链接、执行报告链接 | `reports/` |
| 移交项 | `design.md` 或后续 track proposal |

## 控制论 + DEPA actor 执行模型

mission execution is a cybernetic actor loop over a DAG-shaped desired state.

| Actor | 控制论角色 | DEPA 归属 | 职责 |
|---|---|---|---|
| `MissionPlanner` | 期望态产出者 | Processor + Actor | 产出或修订 desired mission graph：TaskGroup/Task、依赖、门禁、TrackLink |
| `MissionObserver` | 传感器 | Data + Actor | 读取 actual state projection：mission.xml、track 状态、archive、测试结果、reports、用户新约束 |
| `MissionReconciler` | 控制器 | Processor + Actor | 比较 desired vs actual，判定 drift / ready / blocked / done |
| `MissionApplier` | 执行器 | Effect + Actor | 唯一执行收敛动作：启动 mission、创建/续跑/归档 track、修订 mission.xml、写 reports |

循环协议：

```text
MissionObserver 观测实际态
-> MissionReconciler 比较 mission.xml 期望态 vs 实际态
-> MissionPlanner 在必要时提出重规划
-> MissionApplier 执行一个 bounded action
-> 写 report / 更新 mission.xml
-> 下一轮
```

纪律：

- **level-triggered**：每轮读取当前实际态，不依赖“上一轮我以为做过什么”。
- **evidence-based**：重规划必须有 evidence 或 human decision。
- **idempotent**：同样 desired + actual 不重复创建 track、不重复归档。
- **bounded action**：每轮只执行一个有限动作，避免长周期自动化漂移。
- **chat history is not state**：恢复点只来自 `mission.xml`、`analysis/`、`reports/` 和实际 track 状态。

## 受控重规划

active mission 执行中允许：

- 新增节点：发现必须先补证据、先建底座 track、先跑验证。
- 删除节点：证伪、过时、被合并。
- 修改节点：目标、验收、依赖、状态变化。
- 修改 DAG：依赖顺序变化、并行转串行、拆分 wave。
- 人工介入：用户暂停、改目标、批准 / 拒绝某个 convergence action。

每次重规划必须：

1. 写 `reports/replan-XXX.md` 或 `reports/human-intervention-XXX.md`。
2. 说明 trigger、actual state、desired state、diff、decision、applied change。
3. 更新 `mission.xml` 的 `Metadata.Revision` 和 `UpdatedAt`。
4. 若决策有长期约束，追加到 `decisions.md`，必要时写 `decisions/<slug>.md`。

## 使用规则

- 用 `codument-plan-mission` 创建 pending mission。
- 用 `codument-impl-mission` 启动或续跑 active mission。
- 用 `codument-archive-mission` 归档 completed / cancelled / superseded mission。
- 发现稳定领域知识、承重决策、复用教训时，仍按 `std/attractors/knowledge-tiers.md` 晋升到 owner 层；不要让 mission 成为长期知识垃圾桶。
- 旧 `missions/<mission-id>/roadmap.md` 形态可以手工迁移为新结构；新规范不要求自动迁移旧 mission。
