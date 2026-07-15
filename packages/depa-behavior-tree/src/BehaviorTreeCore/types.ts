/**
 * BehaviorTree Core - Type Definitions
 *
 * Generic behavior tree framework supporting custom node types and configurations
 */

/**
 * Built-in node kinds (control flow types)
 */
export enum BehaviorTreeNodeKind {
  /** Execute children in sequence, all must succeed */
  Sequence = 'Sequence',

  /** Try children in order, stop at first success */
  Selector = 'Selector',

  /** Evaluate a condition expression */
  Condition = 'Condition',

  /** Execute a leaf action */
  Action = 'Action',

  /** Loop children until condition is met */
  Until = 'Until',
}

/**
 * Node execution status
 */
export enum BehaviorTreeNodeStatus {
  /** Not yet started */
  Init = 'Init',

  /** Currently executing */
  Started = 'Started',

  /** Completed successfully */
  Success = 'Success',

  /** Failed */
  Failure = 'Failure',

  /** Skipped/omitted */
  Omitted = 'Omitted',
}

/**
 * Behavior result for node execution
 */
export enum BehaviorResult {
  Success = 'Success',
  Failure = 'Failure',
  Running = 'Running',
}

/**
 * Command types for the execution stack
 */
export enum BehaviorTreeCmdType {
  /** Visit a node (triggers visitNode) */
  VisitNode = 'VisitNode',

  /** Finish a leaf node (triggers onFinishLeafNode) */
  FinishLeafNode = 'FinishLeafNode',

  /** Child node finished (triggers onChildNodeFinish) */
  FinishChildNode = 'FinishChildNode',
}

/**
 * Base interface for all node configurations
 */
export interface INodeConfig {
  // Base config, extended by specific node types
}

/**
 * Configuration with expression support
 */
export interface IExpressionNodeConfig extends INodeConfig {
  /** JavaScript expression to evaluate */
  expression: string;
}

/**
 * Generic behavior tree node
 *
 * @template TNodeType - Enum or union type for custom node types
 * @template TConfig - Configuration type (varies by node type)
 */
export interface BehaviorTreeNode<TNodeType = string, TConfig extends INodeConfig = INodeConfig> {
  /** Node kind (built-in control flow type) */
  Kind: BehaviorTreeNodeKind;

  /** Custom node type (business-specific) */
  Type: TNodeType;

  /** Unique identifier */
  Key: string;

  /** Optional display name for debugging/serialization */
  Name?: string;

  /** Optional attribute bag for serialization adapters */
  Attr?: Record<string, string | undefined>;

  /** Current execution status */
  Status: BehaviorTreeNodeStatus;

  /** Node-specific configuration */
  Config: TConfig;

  /** Child nodes */
  Children: BehaviorTreeNode<TNodeType, TConfig>[];

  /** Parent node key (set during tree construction) */
  Parent?: string;
}

/**
 * Command for the execution stack
 */
export interface BehaviorTreeCmd {
  /** Command type */
  Type: BehaviorTreeCmdType;

  /** Target node key */
  NodeId: string;

  /** Execution result (for FinishLeafNode and FinishChildNode) */
  Result?: BehaviorResult;

  /** Child index (for FinishChildNode) */
  ChildIndex?: number;
}

/**
 * Runtime data for behavior tree execution
 *
 * @template TNodeType - Custom node type
 * @template TConfig - Configuration type
 */
export interface BehaviorTreeData<TNodeType = string, TConfig extends INodeConfig = INodeConfig> {
  /** Root node of the tree */
  NodeTree: BehaviorTreeNode<TNodeType, TConfig>;

  /** Variable storage (scoped by node key) */
  Vars: Map<string, any>;

  /** Command stack (pending operations) */
  CmdStack: BehaviorTreeCmd[];

  /** Command history (completed operations) */
  CmdHistory: BehaviorTreeCmd[];

  /** Node lookup map (key -> node) */
  NodeMap: Map<string, BehaviorTreeNode<TNodeType, TConfig>>;
}

/**
 * Execution context passed to node logic and action handlers
 */
export interface ExecutionContext<TNodeType = string, TConfig extends INodeConfig = INodeConfig> {
  /** Current node */
  node: BehaviorTreeNode<TNodeType, TConfig>;

  /** Runtime data */
  btData: BehaviorTreeData<TNodeType, TConfig>;

  /** Get variable value */
  getVar(key: string): any;

  /** Set variable value */
  setVar(key: string, value: any): void;

  /** Evaluate expression */
  evalExpression(expr: string): any;

  /** Optional externally injected runtime dependency */
  runtime?: unknown;
}
