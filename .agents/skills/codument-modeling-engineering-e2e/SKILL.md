---
name: codument-modeling-engineering-e2e
description: 运行 codument modeling + engineering 真实大模型端到端验证。用于验证 init 后开启 modeling/engineering、真实 agent 创建 track 并生成 modeling_deltas/engineering_deltas、实现代码、运行 validate 与代码质量评分的完整流程；也用于复跑 todo/ecommerce/blog 三业务题目或自定义业务题目。
---

# Codument · Modeling + Engineering E2E

使用本 skill 时，在 codument 仓库根运行真实 E2E 脚本；不要把真实大模型 E2E 放进普通 `bun test`。

## 快速运行

```bash
MODE=plan-only AGENT=codex MODEL=gpt-5.5 bash scripts/verify-modeling-engineering-e2e.sh ecommerce
```

完整链路（会继续让 agent 写代码并评分）：

```bash
MODE=full AGENT=codex MODEL=gpt-5.5 bash scripts/verify-modeling-engineering-e2e.sh ecommerce
```

三业务题目：

```bash
for topic in todo ecommerce blog; do
  MODE=plan-only AGENT=codex MODEL=gpt-5.5 bash scripts/verify-modeling-engineering-e2e.sh "$topic"
done
```

自定义题目：

```bash
PRODUCT="$(cat product.md)" MODE=full bash scripts/verify-modeling-engineering-e2e.sh custom
```

## 运行模式

- `MODE=plan-only`：初始化项目、开启 modeling + engineering、真实 agent 创建 track、生成并 validate `modeling_deltas` / `engineering_deltas`。
- `MODE=full`：在 plan-only 成功后，继续真实 agent 实现代码，并运行代码质量评分。
- `ENGINEERING=0`：兼容旧 modeling-only 回归。
- `KEEP=1`：保留 `/tmp/cdt-me-e2e-*` 工作区供检查，默认开启。
- `SKIP_AGENT=1`：只做脚本 smoke，不调用真实大模型；不能作为有效 E2E 结论。
- `AGENT_TIMEOUT=3600`：单次真实 agent 调用超时秒数；本机有 `timeout`/`gtimeout` 时生效。

## 判定标准

E2E 至少要检查：

- `codument validate <track> --strict` 通过。
- `codument modeling validate --deltas <track>` 通过。
- `codument engineering validate --deltas <track>` 通过（当 `ENGINEERING=1`）。
- full 模式下存在 `reports/code-quality.json` 和 `reports/code-quality.md`。
- 失败时保留 `_agent-plan.log`、`_agent-impl.log`、track 文件和 validate 输出。

## 失败排查

- 没生成 track：看 `_agent-plan.log`，通常是 agent 没遵循 `AGENTS.md` 或旧 skill 名。
- 复杂题目卡在生成 track：确认 prompt 中要求分批落盘；真实 codex 曾在一次性巨大补丁前长时间无产物。
- modeling validate 失败：检查 XNL 语法、component IO、id 与 `<plane>/<context>.xnl` 路径对齐。
- engineering validate 失败：检查 `#<plane>.<category>.<topic>.<name>` 与 `<plane>/<category>/<topic>.xnl` 对齐，以及 kind 的必需块；规则类目录使用 `rules`，不要用 `rule`。
- 代码质量低：使用 `codument-code-quality-score` skill 读取报告并做人工复核。

## 输出位置

默认工作区：

```text
/tmp/cdt-me-e2e-<topic>-<pid>/
  _agent-plan.log
  _agent-impl.log
  codument/tracks/<track>/
  reports/code-quality.json
  reports/code-quality.md
```
