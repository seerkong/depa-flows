/**
 * CtrlFlowEngine Runtime
 *
 * 逻辑流引擎的运行时上下文
 * 封装了 BehaviorTreeCore，提供逻辑流特定的功能
 */

import { BehaviorTreeCoreRuntime } from '../BehaviorTreeCore/BehaviorTreeCoreRuntime';
import { CtrlFlowNodeType } from './types';
import { INodeConfig } from '../BehaviorTreeCore/types';

/**
 * CtrlFlowEngine Runtime Class
 */
export class CtrlFlowEngineRuntime {
  // ============ 其他域的 runtime 实例 start ============

  /**
   * 行为树核心引擎 Runtime（可选，延迟创建）
   * 在执行时动态创建并传入 action handlers
   */
  behaviorTreeCoreRuntime?: BehaviorTreeCoreRuntime<CtrlFlowNodeType, INodeConfig>;

  // ============ 其他域的 runtime 实例 end ============

  // ============ 逻辑依赖 start ============

  /**
   * 日志收集器（可选依赖）
   */
  logCollector?: string[];

  /**
   * 测试断言处理器（可选依赖）
   */
  assertionHandler?: (expression: string, errorMessage?: string) => void;

  // ============ 逻辑依赖 end ============

  // ============ 引擎配置 start ============

  /**
   * 测试引擎选项
   */
  options: {
    enableLogCollection?: boolean;  // 是否启用日志收集
    timeout?: number;                // 测试超时时间（毫秒）
    maxIterations?: number;          // 最大迭代次数
  };

  // ============ 引擎配置 end ============

  // ============ 外部上下文 start ============

  /**
   * 外部传入的测试参数（不可变）
   * 【外部产生】【值对象】【不可变】
   */
  outerCtx: {
    testName?: string;
    testId?: string;
    externalVars?: Record<string, any>;
  };

  // ============ 外部上下文 end ============

  // ============ 内部上下文 start ============

  /**
   * 内部测试执行上下文（可变）
   * 【内部产生】【值对象】【可变】
   */
  innerCtx: {
    startTime?: number;
    endTime?: number;
    executionDuration?: number;
  };

  /**
   * 错误上下文（可变）
   * 【内部产生】【值对象】【可变】
   */
  errorCtx: {
    testErrors: Array<{
      message: string;
      stack?: string;
      timestamp: number;
    }>;
  };

  // ============ 内部上下文 end ============

  constructor(init?: Partial<CtrlFlowEngineRuntime>) {
    this.behaviorTreeCoreRuntime = init?.behaviorTreeCoreRuntime;
    this.logCollector = init?.logCollector;
    this.assertionHandler = init?.assertionHandler;
    this.options = init?.options || {};
    this.outerCtx = init?.outerCtx || {};
    this.innerCtx = init?.innerCtx || {};
    this.errorCtx = init?.errorCtx || { testErrors: [] };
  }

  /**
   * 记录测试错误
   */
  recordTestError(message: string, stack?: string): void {
    this.errorCtx.testErrors.push({
      message,
      stack,
      timestamp: Date.now(),
    });
  }

  /**
   * 收集日志
   */
  collectLog(log: string): void {
    if (this.logCollector) {
      this.logCollector.push(log);
    }
  }
}
