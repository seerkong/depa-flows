---
name: codument-code-quality-score
description: 对 codument track 实现或 modeling+engineering E2E 生成的代码做证据化质量评分和评价。用于运行 scripts/score-e2e-code-quality.ts，结合测试、typecheck、lint、build、codument validate、modeling/engineering validate、架构边界、可维护性和安全/数据一致性输出 0-100 分、等级、问题和改进建议。
---

# Codument · Code Quality Score

使用本 skill 时，先运行确定性评分脚本，再补人工/agent 复核。评分必须带证据，不只给一句主观评价。

## 快速运行

```bash
bun run scripts/score-e2e-code-quality.ts /tmp/cdt-me-e2e-ecommerce-1234 --track <track-id>
```

指定输出目录：

```bash
bun run scripts/score-e2e-code-quality.ts <workspace> --track <track-id> --out <workspace>/reports
```

输出：

```text
reports/code-quality.json
reports/code-quality.md
```

## 评分维度

总分 0-100，脚本按以下维度给出初评：

- Runnable behavior：项目是否可构建/可运行，codument track 是否可 validate。
- Tests and type safety：是否有测试，测试和 typecheck 是否通过。
- Architecture fit：源码结构是否存在，是否和 modeling/engineering deltas 对齐。
- Codument alignment：track、modeling validate、engineering validate 是否通过。
- Maintainability：lint、模块拆分、文件组织。
- Safety and data boundaries：输入校验、权限/策略、事实源/写路径边界、工程规则。

## 人工复核要求

读 `code-quality.md` 后补充：

- 哪些分数来自机器证据，哪些是人工判断。
- 关键高风险问题按严重度排序。
- 代码是否真的满足 behavior case，而不是只让测试通过。
- modeling 的事实源、状态机、组件 IO 是否在代码中有对应实现。
- engineering 的 howto/rules/reference/code-map 是否被实现遵循。
- 如果无法运行某命令，明确标记为未验证，不要当作通过。

## 推荐输出格式

```markdown
总分：82/100（B）

主要问题：
- P1: ...
- P2: ...

证据：
- `bun test`: pass
- `codument modeling validate --deltas <track>`: pass
- ...

建议：
- ...
```
