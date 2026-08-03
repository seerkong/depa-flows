# 历史 Decision Registry 迁移协议

仅在 `codument-migrate` 的 `what` 为 `decisions` 或 `all` 时执行本协议。把历史 `decision.md` 和旧 XNL source 迁入 canonical `codument/decisions/**/*.xnl`，同时保留可追溯证据、未知信息和回滚能力。

## 目录

- [1. 不变量](#1-不变量)
- [2. 建立迁移工作区](#2-建立迁移工作区)
- [3. Inventory 与分类](#3-inventory-与分类)
- [4. 从 archive 恢复完整 XNL](#4-从-archive-恢复完整-xnl)
- [5. Markdown-only 保真转换](#5-markdown-only-保真转换)
- [6. Issue 与 conflict 处理](#6-issue-与-conflict-处理)
- [7. Staging、验证与提交](#7-staging验证与提交)
- [8. Rollback](#8-rollback)
- [9. Verification 与迁移报告](#9-verification-与迁移报告)

## 1. 不变量

执行迁移时遵守以下不变量：

- 把 stable decision `#id` 作为 identity；不要用时间戳目录、文件名或 owner file 作为 identity。
- 把 `codument/decisions/**/*.xnl` 作为 canonical registry。不要让 legacy `decision.md`、archive `summary.md` 或其他派生 Markdown 参与 merge、stable-id index 或 `decision://` resolution。
- 优先从 archive 恢复完整 XNL AST。不要根据有损 Markdown summary 重建 archive 中仍然存在的字段。
- 同时扫描 archive 根 `decisions.xnl` 和递归 `decisions/**/*.xnl`。不要因为其中一类存在而跳过另一类。
- 保留匹配 decision 所在 top-level tree closure、ancestor、nested hierarchy、关联字段、未知 attributes/metadata/extension 和 provenance。不要展平 decision tree。
- 只转换能够从源中直接证明的 Markdown 字段。不要臆造 question、options、hierarchy、activation、derived_from、depends_on、status 或其他缺失事实。
- 遇到 missing source、duplicate candidate、identity ambiguity 或 target conflict 时停止该条目的提交，保留源并报告 issue。不要按扫描顺序任取候选，也不要静默覆盖。
- 在 staging registry 完成 syntax、schema、duplicate-id、hierarchy 和 reference validation 前，不要修改 live registry。
- 在验证迁移和备份可恢复前，不要删除或改写 legacy source 与 archive provenance。

## 2. 建立迁移工作区

1. 创建唯一工作目录：

   ```text
   .tmp/codument/migrate-<UTC-timestamp>/
     inventory.json
     manifest.json
     backup/
     staging/
     reports/
   ```

2. 记录 workspace 绝对路径、迁移开始时间、执行工具版本、Git HEAD（如存在）和当前 worktree 状态。
3. 使用 SHA-256 计算所有输入、备份和输出文件的 hash。按二进制原始字节计算，不要在 hash 前规范化换行或编码。
4. 把所有将被修改的 live target 复制到 `backup/`，保持相对路径。把所有 legacy `decision.md` 复制到 `backup/legacy-sources/`。
5. 把引用的 archive source 路径和 SHA-256 写入 manifest。archive 应保持只读；如操作环境不能保证只读，再把引用的 source 复制到 `backup/archive-sources/`。
6. 在任何写入 live registry 的操作前，验证备份文件存在、数量符合 inventory，且 backup hash 与 source hash 一致。

不要把备份放进 `codument/decisions/`，否则递归 registry 扫描可能把备份误当成 canonical input。

## 3. Inventory 与分类

### 3.1 扫描输入

递归扫描并稳定排序：

- `codument/decisions/**/*.md`：legacy records；
- `codument/decisions/**/*.xnl`：当前 canonical target；
- `codument/tracks/archived/**/decisions.xnl`；
- `codument/tracks/archived/**/decisions/**/*.xnl`；
- 旧 archive 根或已知 legacy archive 中的等价 decision source。

忽略 `.tmp/`、backup、generated summary 和非 decision registry 文件。解析每个 XNL 文件的完整 AST，并建立全局 `id -> {file, node, ancestors, topLevelOwner}` index。

### 3.2 提取可证实信息

对每个 legacy record：

1. 记录 source relative path、SHA-256 和完整原始字节备份。
2. 只在格式明确时提取：
   - `Decision URI: decision://<id>` 或等价明确 stable id；
   - `Source: archive://<archive-id>`；
   - 明确标注的 status、durable flag、evidence、confidence、reversibility；
   - 文档中逐字存在的历史 narrative。
3. 记录同一 Markdown 是否表达多个 decision/choice、一个 URI 是否可能覆盖多个历史选择、标题与 URI 是否冲突。
4. 不要把目录名中的 slug 自动当作 authoritative id；只能把它记为候选或 supporting evidence。

### 3.3 分类

为每条 legacy record 指定且只指定一个主分类：

| classification | 条件 | 动作 |
|---|---|---|
| `archive-recoverable` | 有明确 archive provenance、stable id，且组合 source set 中恰好一个匹配 node/tree | 恢复完整 XNL tree closure |
| `markdown-only` | 没有可恢复 XNL source，但 Markdown identity 与内容足以产生不臆造事实的保真记录 | 执行保真转换 |
| `missing-source` | 声明了 archive source，但 archive 不存在、不可读或没有匹配 id | 阻塞该条目并报告 |
| `ambiguous-id` | stable id 不明确，或 archive source set 中有多个匹配 candidate | 阻塞该条目并报告全部候选 |
| `target-conflict` | canonical registry 已有同 id node，且与恢复/转换结果不等价 | 阻塞该条目并生成 conflict evidence |
| `already-canonical` | canonical registry 已有同 id 且语义等价的完整 node | 标记幂等，无 registry 写入 |
| `invalid-source` | Markdown/XNL 无法可靠解析或 source hash 在迁移中变化 | 阻塞该条目并报告 |

不要把 `missing-source` 自动降级成 `markdown-only`。只有在 manifest 中明确记录 archive recovery 失败、保留原文、并经人工或既定策略批准后，才能另开转换尝试；原 issue 仍须保留。

## 4. 从 archive 恢复完整 XNL

对 `archive-recoverable` 条目依次执行：

1. 通过明确的 `archive://<archive-id>` 定位 archive。允许 bucket 目录，但要求最终 archive directory identity 精确匹配；不要用模糊子串选择。
2. 同时加载：
   - `<archive>/decisions.xnl`；
   - `<archive>/decisions/**/*.xnl`。
3. 在所有嵌套 decision nodes 中按完整 stable id 查找。记录每个候选的 file、node path、ancestor ids 和 hash。
4. 要求 candidate 数量恰好为 1：
   - 为 0：改为 `missing-source`；
   - 大于 1：改为 `ambiguous-id`，即使候选文本看似相同也先 fail closed。
5. 选择 candidate 所属的 top-level tree closure，不只复制展平后的匹配 node。保留完整 AST，包括未知字段、question、recommendation、options、answer、depends_on、activation、derived_from、nested decisions 与 provenance。
6. 确定 target owner：
   - canonical registry 已有该 id 时，保持当前 owner；
   - archive recursive source 的新 tree 优先保留相对 `decisions/` 的 owner path；
   - archive 根 `decisions.xnl` 的新 tree 使用 registry 当前稳定 root owner policy（缺省 `registry.xnl`）。
7. 在 staging 中按 stable id 合并：
   - 语义等价：标记 `already-canonical`；
   - 不等价且没有可信 merge base：标记 `target-conflict`；
   - 不要把 live target 当成共同 base，也不要静默选择 source 或 target。
8. 在 manifest 记录 legacy summary、archive source、匹配 node path、tree owner、source hash、target owner、staged hash 和语义比较结果。

恢复成功的 canonical node 必须来自 archive AST/serializer 路径，不能来自 Markdown 字段投影。

## 5. Markdown-only 保真转换

对确认属于 `markdown-only` 的条目依次执行：

1. 保留原始 Markdown 的逐字节备份、相对路径、编码（可检测时）、换行形式、大小和 SHA-256。
2. 只有 stable id 可由明确 URI 或其他唯一证据证明时，才创建 canonical decision。若一个文档包含多个历史选择但只暴露一个 URI，标记 `ambiguous-id` 或 migration issue；不要擅自拆分和生成新 ids。
3. 只映射明确存在且含义无歧义的字段。保留原文措辞，不把 narrative 改写成更确定的 question、answer 或 rationale。
4. 在 XNL provenance/extension 中记录：
   - migration kind 为 `markdown-only`；
   - legacy source relative path 与 SHA-256；
   - migration timestamp 和工具版本；
   - raw Markdown 全文，或可验证的 immutable backup reference 加 hash；
   - 所有未确定字段和 ambiguity issue。
5. 若内嵌 raw Markdown，使用 XNL serializer 的 text block 能力保留完整内容；执行 parse → serialize → parse 语义检查，并对提取后的 raw text 再做 hash/逐字比较。若不能证明内嵌内容保真，只保留 immutable backup reference，不要写一个截断或转义损坏的副本。
6. 不添加 source 中不存在的 `question`、`options`、`activation`、`derived_from`、`depends_on` 或 parent relation。对无法确定的 status/durable flag 不设默认值；把缺失事实写入 issues。
7. 把转换结果放入 staging owner file；在完整 registry validation 通过前不要写 live registry。

建议的 provenance 语义如下；具体 XNL 排版由 serializer 负责，不要手工转义 raw content：

```text
legacy source path + SHA-256
conversion kind = markdown-only
raw content or immutable backup reference
migration issues = [unknown-field, multi-choice-one-uri, ...]
```

## 6. Issue 与 conflict 处理

每个 issue 至少记录 `code`、`decisionId`（未知时为 `null`）、source path、candidate paths、reason、evidence、blocking 和 suggested action。

使用稳定 issue code：

- `MISSING_ARCHIVE`
- `MISSING_DECISION_ID`
- `ARCHIVE_ID_NOT_FOUND`
- `DUPLICATE_ARCHIVE_CANDIDATE`
- `MULTIPLE_CHOICES_ONE_ID`
- `TARGET_DUPLICATE_ID`
- `TARGET_SEMANTIC_CONFLICT`
- `INVALID_XNL`
- `RAW_CONTENT_MISMATCH`
- `SOURCE_CHANGED_DURING_MIGRATION`
- `UNRESOLVED_REFERENCE`

处理原则：

- 把 blocking issue 留在 manifest/report 中，并让该条目保持未提交。
- 保留 legacy source 和所有候选；不要删除、重命名成“已迁移”或修改其内容。
- 对 conflict 同时记录 source node、target node、owner files 和结构化 diff；不要只记录一句“冲突”。
- 允许无冲突条目继续 staging，但只有在提交策略明确支持部分提交且 report 能区分 committed/blocked 时才部分提交。缺省采用整批原子提交。

## 7. Staging、验证与提交

### 7.1 构建 staging

1. 从 live `codument/decisions/` 的 canonical XNL 文件复制出 staging 基线。
2. 不复制 legacy Markdown、summary 或 backup 到 canonical staging。
3. 把所有可恢复/可转换 tree 合并到 staging，保持 owner path 和 stable-id identity。
4. 生成 staging inventory 和每个 XNL 文件的 SHA-256。

### 7.2 验证 staging

至少执行：

1. 解析每个 staging XNL 文件，验证 syntax/schema。
2. 递归建立全局 stable-id index，拒绝跨文件和 nested duplicate ids。
3. 验证 hierarchy、depends_on、activation、derived_from references 和 dependency cycle。
4. 对 archive-recoverable 条目比较 source tree 与 staged tree 的完整 AST/语义；允许 serializer 的非语义排版差异，不允许字段、unknown extension 或 hierarchy 丢失。
5. 对 Markdown-only 条目比较 raw content 或 immutable backup reference/hash，确认所有 ambiguity/issues 仍存在。
6. 比较迁移前 identity inventory 与迁移结果：
   - 每条 legacy identity 必须是 `staged`、`already-canonical` 或显式 `blocked`；
   - 不允许静默遗漏；
   - 不允许新增无来源 identity。
7. 尝试运行：

   ```text
   codument decisions validate <staging-or-supported-target>
   codument validate --strict
   ```

   若 CLI 不支持直接验证 staging 路径，先用同一 registry loader 做本地等价验证；记录能力限制，不要为了运行命令提前覆盖 live registry。

### 7.3 提交

只有在备份验证完成、manifest 已持久化、staging 全部通过且 blocking policy 满足时才提交：

1. 记录 live target 提交前 hash。
2. 使用同文件系统的临时目录和 rollback-capable replace，把 staging XNL tree 替换为 live canonical XNL tree。
3. 提交后重新加载 live registry并重复 syntax、duplicate-id、reference 和 semantic parity 验证。
4. 记录 committed file hash、decision owner、identity set 和提交时间。
5. 保留 legacy source，直到迁移报告被审核且显式清理策略获准。即使之后清理 canonical 目录中的 legacy Markdown，也必须保留 backup/manifest 和 archive provenance。

## 8. Rollback

出现任一情况时立即 rollback：

- staging 与 source semantic parity 不一致；
- raw content/reference hash 不一致；
- live commit 中途失败；
- commit 后 validation 失败；
- source 在 inventory 后发生变化；
- manifest 无法解释所有 legacy identities。

执行 rollback：

1. 停止后续写入。
2. 用 backup 中逐路径验证过的文件恢复所有已替换 live targets。
3. 删除本次提交创建、但 backup inventory 中不存在的 target 文件；只删除 manifest 明确列出的本次新文件。
4. 重新计算 live target hash，并与 pre-migration manifest 对照。
5. 重新运行 registry validation。
6. 保留 staging、manifest、日志和 issue evidence，状态记为 `rolled-back`。不要删除失败证据。

不要对 workspace 根目录或未解析的通配路径执行递归删除。逐个解析、校验并记录 rollback target。

## 9. Verification 与迁移报告

最终报告必须同时提供人类可读摘要和机器可读 manifest。报告至少回答：

- 扫描了多少 legacy Markdown、canonical XNL 和 archive XNL；
- 每个 legacy identity 的 classification 与最终状态；
- 每个 archive-recoverable node 的 source/target owner、tree path 和 semantic parity 结果；
- 每个 Markdown-only record 的 raw provenance、保真验证和 ambiguity issues；
- 所有 missing/ambiguous/conflicting 条目及未提交原因；
- backup 路径、manifest 路径、hash 算法和 rollback 是否演练/执行；
- staging 与 live validation 命令及结果；
- legacy source 是否仍保留，是否有显式后续清理动作。

机器可读 manifest 使用以下最小 schema；可增加字段，不要删除证据字段：

```json
{
  "schemaVersion": 1,
  "migrationId": "migrate-<UTC-timestamp>",
  "workspace": "<absolute-path>",
  "startedAt": "<ISO-8601>",
  "completedAt": "<ISO-8601-or-null>",
  "hashAlgorithm": "sha256",
  "atomicity": "batch",
  "backupRoot": ".tmp/codument/migrate-<timestamp>/backup",
  "stagingRoot": ".tmp/codument/migrate-<timestamp>/staging",
  "preMigrationRegistry": [
    {
      "path": "codument/decisions/registry.xnl",
      "sha256": "<hash>"
    }
  ],
  "records": [
    {
      "legacyPath": "codument/decisions/.../decision.md",
      "legacySha256": "<hash>",
      "decisionId": "<stable-id-or-null>",
      "archiveId": "<archive-id-or-null>",
      "classification": "archive-recoverable",
      "archiveCandidates": [
        {
          "path": "codument/tracks/archived/.../decisions.xnl",
          "nodePath": "<ast-path>",
          "sha256": "<file-hash>"
        }
      ],
      "targetOwner": "codument/decisions/registry.xnl",
      "preTargetSha256": "<hash-or-null>",
      "stagedSha256": "<hash-or-null>",
      "committedSha256": "<hash-or-null>",
      "semanticParity": "pass",
      "status": "committed",
      "issues": []
    }
  ],
  "validation": [
    {
      "check": "global-stable-id-index",
      "status": "pass",
      "evidence": "<command-or-report-path>"
    }
  ],
  "rollback": {
    "status": "not-needed",
    "evidence": null
  }
}
```

允许的 record `status` 至少包括：

- `inventoried`
- `blocked`
- `staged`
- `already-canonical`
- `committed`
- `rolled-back`

迁移完成条件：每个 inventory record 都有明确 status；所有 committed XNL 通过完整 registry validation；archive recovery 保持 AST/tree 语义；Markdown-only 保持 raw provenance 和 ambiguity；backup/manifest 足以逐路径恢复迁移前状态。
