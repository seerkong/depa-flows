# 产品边界

提供泛型带端口控制图编译与调用侧作用域 Blocks/RunBlock。依据上述 mission design/review.md 与 next-and-blocks.md 的已审合同；代码、规范、测试由本仓库 owner 维护。

2026-10-06补充：partial真实bundle明确三分支A/B共享、C独立Return，仅一个block、If无next，主树+block形成两棵树；loop bundle改为Until内fast/slow汇合advance并更新调用侧iteration，循环后finalize/Return。规范归docs/flow-dsl/spec/port-control-graph/index.md，独立golden/receipt和结构、实际轨迹断言归graph-fixtures.test.ts；不更改既有编译算法语义。
