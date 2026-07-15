---
name: codument-decision-tree
description: 为 plan-track / plan-mission 或已有 track/mission 修订做有界决策树式澄清：先查代码和 codument owner 文档，生成 analysis/decision-tree.md，按 severity=auto|light|normal|deep 控制是否提问，并回写 decisions.md。pre-plan codument-discuss 应直接与人对话，不使用本 skill 生成文件化讨论。
---

# Codument · decision-tree

用于给 track / mission 规划或修订增加有界决策树式澄清。权威规则在工作区：

- `@/codument/std/sop/questioning.md`
- `@/codument/std/attractors/knowledge-tiers.md`

## 输入

- 当前 track 或 mission 目录，或将进入 plan-track / plan-mission 的规划目标。
- 可选 severity：`auto | light | normal | deep`；未指定默认 `light`。

## 执行

1. 先读取本地代码、测试、schema、config、behaviors、modeling、engineering、decisions、archive；能查证的问题不要问用户。
2. 写入或更新 `analysis/decision-tree.md`：
   - Root Question
   - Severity
   - Decision Frontier
   - Assumptions
3. 对非 auto 模式，只问当前 frontier 中最阻塞下游产物、且无法查证的问题；每题给推荐答案、选项、取舍和无回复默认。
4. 对 auto 模式，不提问；选择保守默认并写入 Assumptions / Evidence。
5. 把稳定决策回写 `decisions.md`，推荐字段：
   - Parent
   - Blocks
   - Evidence
   - Confidence
   - Reversibility
   - Durable candidate

## 输出

- `analysis/decision-tree.md`
- 更新后的 `decisions.md`
- 必要时提示运行 `codument decisions validate <track-id>`
