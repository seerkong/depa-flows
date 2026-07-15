/**
 * depa-behavior-tree —— 行为树内核（迁移自 depa-processor src/control）。
 *
 * 两层分发模型：
 *   Kind（控制语义） → NodeLogic     （BehaviorTreeCore）
 *   Type（动作语义） → ActionHandler （CtrlFlowEngine 及其注册表）
 *
 * CtrlFlowEngine 的 barrel 已 re-export BehaviorTreeCore 的公共符号，
 * 根入口直接采用它，避免双 barrel 的重名歧义；
 * 需要精确分层导入时用子路径 'depa-behavior-tree/core' / 'depa-behavior-tree/ctrlflow'。
 */
export * from './BehaviorTreeCore';
export * from './CtrlFlowEngine';
