# 原生修订与可恢复执行设计

## 现状到目标

| 原位置 | 现行为 | 增量 |
| --- | --- | --- |
| ai-workflow-contract/src/index.ts selection contracts | select-existing / author-new | 添加 revise-existing 与 immutable feedback 引用；保持原类型可用 |
| ai-workflow-logic/src/agent-definition-selection.ts | create/absent admission，真实 loadReceipt 精确核验，WeakMap authentic proof | update/present，旧候选+requirement+registry+feedback 因果身份，before authority CAS；pending revision 不能绕过 |
| ai-workflow-contract/src/resource-kind-contracts.ts | MessageSource/ContextPipeline spec=1 Content，identity reader | 保留 v1，增加 spec=2 CodeBinding/Config/Assets/DependencyRefs；原语义指纹不偷偷改成新协议 |
| ai-workflow-logic/src/agent-resources.ts | Agent 对 Context/Source 仅 typed ref | 投影原生代码定义及资源依赖边；纯投影仍不引入 compiler/Node 执行器 |
| ai-workflow-logic/src/run-freeze.ts | 资源内容 closure + branded receipt | 必需代码闭包须已 capture/restore；其 digest 参与 semantic identity；公开原生重建 proof |

## 修订 admission

revise-existing 指向一个 authentic candidate：old candidateDigest、candidateRef、requirementDigest、candidateSetDigest；feedback 包含上游 observation/attempt/verification 引用及旧 execution identity。depa-flows 校验 closed shape、引用和匹配关系，不把调用者文字视为诊断 authority。

提案必须是 Halfcode update、expected.state=present、目标 AIAgentDefinition single-file。CAS 对比 authentic registry 的 effective resource **authorityDigest**，不是 candidate.contentDigest；同时钉住 effective origin/authority unit 与 registry revision。资源成功更新后，只接受 transaction owner 的 loadReceipt 返回的精确持久回执，并验证 before/after、resource、catalog、origin、authority roots 和当前重新投影候选。伪造/foreign receipt、错 before、过时 observation 拒绝。

原 create 的 before=null；update 的 before=已接纳旧 authority digest。pending 按原 owner 管理，修订未 reconcile 时，即使旧 candidate 有先前 authoringEvidence，也不能被选为新任务。旧 frozen task/proof 是不可变运行输入，不被新 admission 替换。Halfcode 宿主事务仍负责真正的原子 CAS 和发布，不在此复制 journal。发布序列若涉及 Context + Agent，先准备依赖版本，再以 Agent recipe 更新为 admission 点，不声称多文档原子事务。

## 原生代码 Kind 与公开执行 API

spec=2 的 CodeBinding 节点含 packageName/module/exportName，正规化为现有 Halfcode CodeBinding（包括 moduleSpecifier）。Config 为闭合 JSON 数据；Assets 声明源根内 text/json 文件；DependencyRefs 是资源间的精确 typed refs，加入 Halfcode dependency snapshot。源根由 runtime 根据资源包映射提供，不把本机路径写入资源文档。

spec=1 Content 继续被原 reader 接纳。需要执行 legacy recipe 时，由明确的兼容 resolver 将 Content 正规化到真实 builtin CodeBinding 及冻结 config，再走同一 capture/bind 链路；不在 depa-flows 放 Eidolon 算法，不把 implementation 字符串当代码。未知 legacy descriptor 明确拒绝执行，不能 latest fallback。

纯投影与执行分离：投影文件只读取 ResourceRecord；server 执行文件调用 halfcode-compiler.xnl/application-assembly 的 captureCodeClosure/validateCodeClosure 和 authoring-runtime 的 bindCodeClosure。capture/restore 产生与 exact projected resource 关联的内存执行凭证。冻结 task 验证凭证与 registry/resource 内容匹配，将 closure digest 和 config/reader identity 纳入运行 semanticFingerprint。Agent 文档不变、内部 helper/资产变化时，新 admission 的运行 identity 也必须变化。

持久材料是 closed JSON artifact，不是序列化函数或 WeakMap。恢复用旧 frozen resource bytes 重建 isolated registry 和原生投影；用 run owner 钉住的 expected digest 校验代码 artifact/环境；重新经公开 freeze/project API 得到 authentic proof。不得 JSON cast 品牌对象、读取最新源码或复用旧全局模块缓存。Halfcode runtime 每次独立模块表，旧新版本共存。宿主 ABI/ambient identity 必须匹配；不承诺安全沙箱或全环境时间旅行。

## 执行期 owner 隔离纠偏

Gap P2-1 用两个真实独立 workspace 复现：A 的 pending revise-existing 会因为全局仅按 FQN 索引而拒绝 B 的合法选择。修订和创建的 pending/superseded 状态应归属显式 selection runtime/owner，并由宿主在同 owner 的各次 observation/refresh/reconcile 中保持同一身份。不可仅按某次 registry 对象分组（刷新会绕过），也不可根据 FQN/packageId/内容摘要或本机路径猜测 owner。

owner 句柄为进程内受控状态依赖，不是持久资源事实，不进入 candidate/requirement 内容摘要。复用原 create/select/update 业务协议，宿主将该依赖接到既有 resource host；对缺少明确 owner 的有状态 authoring 请求应给精确诊断，不再使用全局 FQN 兜底。纯读取/已存在候选选择的兼容入口可保留；新旧 authoring 都须验证同 owner 跨刷新与跨 owner 隔离，且不能挪用另一 owner 的 admission/receipt。这个 API 接缝须同步写入后续 Eidolon 接入，不构建第二资源 registry。

接缝为 root 公开的 `createAIAgentDefinitionSelectionOwner({ receiptAuthority })` 与 opaque `AIAgentDefinitionSelectionOwner`。四个 selection API 输入均接 `selectionOwner`；host 在其全部 observation、refresh、admission/reconcile/freeze 中保留同一 owner。reconcile 的 receiptAuthority 必须就是 factory 绑定的端口，再执行原有持久回执字节和 authority 事实校验。新进程从对应持久 Halfcode store 建立新端口和 owner，不持久化内存品牌，也不在此恢复 publication journal。后续 Eidolon Track 负责接到现有 resource host；本 Track 不改外部仓库。

## Reader 兼容与原生覆盖

Halfcode 的 ExactReaderProfile 对每个 Kind subject 只接纳一个目标 reader；KindDefinition 声明版本集合也必须和接纳的 owner revision 集合精确一致。解析上下文据实际树中的 KindDefinition 选择版本集合，保留全 v1 profile 身份；声明 v1+v2 的新 manifest 使用 v2 reader 和 owner 发布的 v1→v2 Content 保留 resolution。这样同一树内旧 Content 和新 CodeBinding 可共存，既不伪造旧 reader 指纹，也不全局覆盖消费者自行提供的上下文。

资源修订允许原生 global→workspace 覆盖：before 仍钉住原候选 authority/origin，after 必须等于真实持久回执与当前 registry 的 origin/authority unit。不能要求前后 layer 相同，否则会误拒绝合法 Halfcode 覆盖。候选 authoringEvidence.revision 保留旧候选身份及 immutable feedback，且参与新 candidateDigest。

## 任务与验证

### P3：authored authority 与 resolved execution 的原生桥接

宿主真实只读实验确认：authored layers 配 resolved registry 调 deriveResourceAuthoringRegistryRevision 被 Halfcode 的 layer-binding/origin guard 拒绝；composeLayeredResourceRegistry 的基底 ResourceRecord 复制会移除 stage/readerId/effectiveContentDigest。因而不能把 selection registry 简单换成 resolved，也不能声称 codeResourceDigest 中存在 resolved 分支就已经覆盖分层读取身份。保持 Halfcode 既有 authority guard，不扩展本机路径或品牌旁路。

最小公开入口由本 owner 从 authentic authored registry/layers 派生 execution observation。runtime 显式提供每层完整 AIWorkflowResourceResolutionContext（包含宿主注册的 Kind），owner 自己调用既有 resolveAIWorkflowResourceTree、composeLayeredResourceRegistry、Agent projector。不可接收宿主任意构造的 resolved tree 当凭证。context key 集合、顺序及原生 layer identity 必须准确；通过原 composer 保留 shadow/tombstone 拓扑，不能复活删除资源。若输入无法重建某受支持拓扑须精确拒绝。

execution observation 私有关联原 authored authority 和 exact resolved registry/projection，输出不可变。selection 的候选 contract 使用该 resolved projection，但 proposal expected、receipt reconcile、candidate contentDigest 与 previousExecution 的原文档比较保持 authored identity。project/reconcile/selected freeze 通过可选 executionResources 显式绑定同一 observation；普通 freeze 使用同一原生入口。复制 observation、跨 registry/reader observation 挪用 admission/handle、pending 或 superseded 绕过均拒绝。

owner 保留实际 resolver 输出的 reader receipt 身份，不能依赖 composition 丢失的字段：每个参与执行闭包的 resource 的 readerId、readerSpecVersion、effectiveContentDigest（及必要 profile/receipt 身份）写入排序稳定的 resourceResolutions 并进入 semanticFingerprint；code projection 另显式关联对应 resolution identity，进入 code artifact 身份，restore 对比原 recipe/reader/可信 artifact digest。不得把 reader 身份塞入 hostIdentity 或 ambient 字段。dependency snapshot 的 authored digest 与执行 resolution facts 各司其职，不新增 publication receipt 或第二 registry authority。

新进程从 frozen authored bytes、原 exact reader contexts 和可信 artifact pins 重新 resolve/project/restore/freeze，重建 authentic proof。无 bridge 的旧公开调用保持兼容、旧指纹不变；有 bridge 的新闭包显式包含 reader 身份。当前 v1→v2 是 identity spec transform；不承诺 projector 能执行任意 readerValue 变换。若 node 与 readerValue 的业务语义不同，必须由该 Kind owner 明确输入协议，不静默忽略。

P3 TDD：真实 native create/update→resolved candidate→compile→selected freeze；同文档同代码而 reader implementation fingerprint 变化导致新执行身份且旧 artifact 在新 reader 下拒绝；原 reader+code 的独立 OS 进程恢复；foreign/copied/stale observation/handles 拒绝；多层 v1/v2、宿主附加 Kind、tombstone 不复活；无 bridge 的 create/select/freeze 回归。先完成 P2 原范围 GapLoop/方向检查，再实现 P3 并运行其独立 phase GapLoop 和最终 DEPA 检查，不通过增加旧轮数上限掩盖缺口。

P1 两个闭包分别为 selection/reconcile 与代码投影/执行，可并行；公共 index 采用互不重叠局部修改，新代码类型优先独立模块。P2 验证它们合并后的 freeze/recovery 与原 create/select、Ctrl/Data、纯 browser surface。

基线：selection/run-freeze 12 pass / 68 assertions；通过临时源码绑定消费 Halfcode 公开入口时同样通过，跨源码 tsc 通过。Halfcode 前置 Track 已完成：205 pass / 1,085 assertions、旧源物理删除后的独立进程执行；depa-flows 仍须自己的真实资源/proof 验收，不能拿该结果代替。

新增测试先 RED：native update/present 成功、CAS/stale/forged receipt/feedback 错配/pending bypass；spec2 binding/闭合配置/依赖错误；同资源字节下代码变化导致执行 identity 变化；V1 frozen→V2 live→删除 live 后 fresh authentic proof+真实输出；保持原 author-new/select 和 legacy reader。

验证命令使用 bun test --tsconfig-override <session-config> packages/ai-workflow-logic/test 与 tsc --noEmit -p <session-config>。session-config 仅临时源码绑定，不持久化外部物理路径。NO build/install/package check/publish/commit。规划前显式 DEPA 方向检查 PASS：坚持原 authority/CAS/receipt、代码包 owner、反馈只作上游因果输入；最终仍 fresh 检查，不以预审代替验收。
