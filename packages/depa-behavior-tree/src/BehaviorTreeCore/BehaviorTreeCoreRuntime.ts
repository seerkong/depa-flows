/**
 * BehaviorTreeCore Runtime
 *
 * 行为树核心引擎的运行时上下文
 * 按照领域设计，包含执行过程中需要的所有运行时数据
 */

import { BehaviorTreeNode, BehaviorTreeCmd, BehaviorTreeNodeStatus, INodeConfig } from './types';

/**
 * BehaviorTreeCore Inner State
 * 引擎执行过程中的内部状态（可变）
 */
export interface BehaviorTreeCoreInnerState<TNodeType, TConfig extends INodeConfig> {
  // 当前执行过程中的变量存储
  Vars: Map<string, any>;

  // 命令栈（待执行的命令）
  CmdStack: BehaviorTreeCmd[];

  // 命令历史（已执行的命令）
  CmdHistory: BehaviorTreeCmd[];

  // 动态的节点树（带状态）
  NodeTree: BehaviorTreeNode<TNodeType, TConfig>;

  // 节点映射（快速查找）
  NodeMap: Map<string, BehaviorTreeNode<TNodeType, TConfig>>;

  // 当前迭代计数（防止死循环）
  iterationCount: number;
}

/**
 * BehaviorTreeCore Runtime Class
 */
export class BehaviorTreeCoreRuntime<
  TNodeType = string,
  TConfig extends INodeConfig = INodeConfig
> {
  // ============ 逻辑依赖 start ============

  /**
   * 回调函数集合（可选依赖）
   */
  callback: {
    // 表达式求值器
    evaluateExpression?: (
      expr: string,
      runtime: BehaviorTreeCoreRuntime<TNodeType, TConfig>,
      nodeKey: string
    ) => any;
  };

  // ============ 逻辑依赖 end ============

  // ============ 引擎配置 start ============

  /**
   * 引擎配置选项（零散的配置值）
   */
  options: {
    maxIterations?: number; // 最大迭代次数（防止死循环）
    enableHistory?: boolean; // 是否启用命令历史记录
    asyncDelay?: number; // 异步操作延迟（毫秒）
  };

  // ============ 引擎配置 end ============

  // ============ 外部上下文 start ============

  /**
   * 外部传入的初始数据（不可变）
   * 【外部产生】【值对象】【不可变】
   */
  outerCtx: {
    initialVars: Map<string, any>; // 初始变量值
    runtime?: unknown; // 外部注入的运行时依赖
  };

  // ============ 外部上下文 end ============

  // ============ 内部上下文 start ============

  /**
   * 内部执行状态（可变）
   * 【内部产生】【值对象】【可变】
   * 这是原来的 BehaviorTreeData 的核心部分
   */
  innerCtx: {
    state: BehaviorTreeCoreInnerState<TNodeType, TConfig>;
  };

  /**
   * 错误上下文（可变）
   * 【内部产生】【值对象】【可变】
   */
  errorCtx: {
    errors: Array<{
      nodeKey: string;
      error: Error;
      timestamp: number;
    }>;
  };

  // ============ 内部上下文 end ============

  constructor(init?: Partial<BehaviorTreeCoreRuntime<TNodeType, TConfig>>) {
    this.callback = init?.callback || {};
    this.options = init?.options || {};
    this.outerCtx = init?.outerCtx || {
      initialVars: new Map(),
      runtime: undefined,
    };
    this.innerCtx = init?.innerCtx || {
      state: {
        Vars: new Map(),
        CmdStack: [],
        CmdHistory: [],
        NodeTree: null as any, // 需要外部设置
        NodeMap: new Map(),
        iterationCount: 0,
      },
    };
    this.errorCtx = init?.errorCtx || { errors: [] };
  }

  /**
   * 初始化内部状态（用于首次执行）
   */
  initializeState(staticTree: BehaviorTreeNode<TNodeType, TConfig>): void {
    // 复制初始变量
    this.innerCtx.state.Vars = new Map(this.outerCtx.initialVars);

    // 清空命令栈和历史
    this.innerCtx.state.CmdStack = [];
    this.innerCtx.state.CmdHistory = [];

    // 深拷贝树结构（带状态）
    this.innerCtx.state.NodeTree = this.cloneTreeWithStatus(staticTree);

    // 构建节点映射
    this.buildNodeMap(this.innerCtx.state.NodeTree);

    // 重置迭代计数
    this.innerCtx.state.iterationCount = 0;

    // 清空错误
    this.errorCtx.errors = [];
  }

  /**
   * 深拷贝树结构，添加状态字段
   */
  private cloneTreeWithStatus(
    node: BehaviorTreeNode<TNodeType, TConfig>
  ): BehaviorTreeNode<TNodeType, TConfig> {
    return {
      ...node,
      Status: BehaviorTreeNodeStatus.Init,
      Children: node.Children.map((child) => this.cloneTreeWithStatus(child)),
    };
  }

  /**
   * 构建节点映射
   */
  private buildNodeMap(node: BehaviorTreeNode<TNodeType, TConfig>, parentKey?: string): void {
    node.Parent = parentKey;
    this.innerCtx.state.NodeMap.set(node.Key, node);

    for (const child of node.Children) {
      this.buildNodeMap(child, node.Key);
    }
  }

  /**
   * 获取变量
   */
  getVar(key: string): any {
    return this.innerCtx.state.Vars.get(key);
  }

  /**
   * 设置变量
   */
  setVar(key: string, value: any): void {
    this.innerCtx.state.Vars.set(key, value);
  }

  /**
   * 记录错误
   */
  recordError(nodeKey: string, error: Error): void {
    this.errorCtx.errors.push({
      nodeKey,
      error,
      timestamp: Date.now(),
    });
  }

  /**
   * 推送命令
   */
  pushCommand(cmd: BehaviorTreeCmd): void {
    this.innerCtx.state.CmdStack.push(cmd);
  }

  /**
   * 获取下一个命令
   */
  popCommand(): BehaviorTreeCmd | undefined {
    const cmd = this.innerCtx.state.CmdStack.shift();
    if (cmd && this.options.enableHistory) {
      this.innerCtx.state.CmdHistory.push(cmd);
    }
    return cmd;
  }

  /**
   * 求值表达式
   */
  evalExpression(expr: string, nodeKey: string): any {
    if (this.callback.evaluateExpression) {
      return this.callback.evaluateExpression(expr, this, nodeKey);
    }
    throw new Error('Expression evaluator not provided');
  }

  /**
   * 获取节点
   */
  getNode(nodeKey: string): BehaviorTreeNode<TNodeType, TConfig> | undefined {
    return this.innerCtx.state.NodeMap.get(nodeKey);
  }

  /**
   * 检查是否完成
   */
  isComplete(): boolean {
    return (
      this.innerCtx.state.CmdStack.length === 0 &&
      (this.innerCtx.state.NodeTree.Status === BehaviorTreeNodeStatus.Success ||
        this.innerCtx.state.NodeTree.Status === BehaviorTreeNodeStatus.Failure)
    );
  }

  /**
   * 获取结果
   */
  getResult(): 'Success' | 'Failure' | 'Running' {
    if (this.innerCtx.state.NodeTree.Status === BehaviorTreeNodeStatus.Success) {
      return 'Success';
    } else if (this.innerCtx.state.NodeTree.Status === BehaviorTreeNodeStatus.Failure) {
      return 'Failure';
    } else {
      return 'Running';
    }
  }
}
