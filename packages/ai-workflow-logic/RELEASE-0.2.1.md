# Agent code 0.2.1

仅发布 ai-workflow-contract/logic 0.2.1，依赖 Halfcode 0.3.1。新增公开 agent-code-execution 子路径，支持按原生资源 reader/code 身份捕获、恢复冻结执行闭包。浏览器入口不引入宿主编译与选择逻辑。

Git提交同时补齐此前已发布但未提交的依赖/runtime源码基线，以保留测试和public metadata的一致性；这些下层包、Ctrl/Data、DSL reference不因本次提交而重复发布。无关Codument迁移不纳入。

消费者必须统一Halfcode/workflow contract/logic的模块版本：Ctrl/Data 0.2.0的exact依赖会产生旧WeakMap owner，不能让它验证新owner产生的proof。本次最小交付采用应用层显式overrides统一到0.3.1/0.2.1/0.2.1，而不是复制源码或alias。

验证入口：`bun tools/verify-agent-code-package.ts <halfcode-tarball>`，发布后`bun tools/verify-agent-code-package.ts --registry`。验证脚本在临时独立消费者安装真实tarball/registry包，只复制tests/fixtures，不复制src、不使用workspace/source bindings；检查传递版本一致，再运行51项/858断言，包括fresh OS恢复、删除live后V1恢复、Ctrl/Data/Holon互操作、资源篡改拒绝及公开browser/root身份。

初次packed验证发现测试自身假定workspace路径，补齐实际task-manager-file-support依赖，并将repository source-graph棘轮与installed public identity验证分开；没有跳过目标运行行为。
