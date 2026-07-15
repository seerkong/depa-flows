/**
 * Logic Flow Engine - Type Definitions
 *
 * Defines logic flow-specific node types and configurations.
 *
 * CtrlFlowNodeType is a string type that is extensible: extensions can add
 * custom node type strings and the engine will accept them.
 */

import { INodeConfig } from '../BehaviorTreeCore';

// ---------------------------------------------------------------------------
// Core node type constants
// ---------------------------------------------------------------------------

/**
 * Core node type constants object.
 * Use these values when building trees with the DSL / Builder.
 */
export const CoreNodeTypes = {
  // Control node types
  Sequence: 'Sequence',
  Selector: 'Selector',
  Condition: 'Condition',
  Until: 'Until',

  // Condition types
  CheckVariable: 'CheckVariable',
  CheckExpression: 'CheckExpression',

  // Action types
  SetVariable: 'SetVariable',
  Log: 'Log',
  Assert: 'Assert',
  Sleep: 'Sleep',
  RunScript: 'RunScript',
  HttpCall: 'HttpCall',
} as const;

/**
 * Union of all core node type string literals.
 */
export type CoreNodeType = (typeof CoreNodeTypes)[keyof typeof CoreNodeTypes];

/**
 * Extensible node type: accepts any core type plus arbitrary strings
 * contributed by extensions.
 */
export type CtrlFlowNodeType = CoreNodeType | (string & {});

/**
 * Backward-compatible namespace that mirrors the old enum shape.
 * Allows existing code using `CtrlFlowNodeType.Sequence` etc. to keep working.
 */
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const CtrlFlowNodeType = CoreNodeTypes;

// ---------------------------------------------------------------------------
// Core config interfaces
// ---------------------------------------------------------------------------

/**
 * Optional metadata used by DSL builders.
 * key/name are user-facing metadata and may be omitted or empty.
 */
export interface CtrlFlowNodeMeta {
  key?: string;
  name?: string;
}

/**
 * Configuration for CheckVariable condition
 */
export interface CheckVariableConfig extends INodeConfig {
  variableName: string;
  expectedValue?: any;
  operator?: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' | 'exists' | 'notExists';
}

/**
 * Configuration for CheckExpression condition
 */
export interface CheckExpressionConfig extends INodeConfig {
  expression: string;
}

/**
 * Configuration for SetVariable action
 */
export interface SetVariableConfig extends INodeConfig {
  variableName: string;
  value: any;
}

/**
 * Configuration for Log action
 */
export interface LogConfig extends INodeConfig {
  message: string;
  level?: 'info' | 'warn' | 'error' | 'debug';
}

/**
 * Configuration for Assert action
 */
export interface AssertConfig extends INodeConfig {
  expression: string;
  errorMessage?: string;
  /** Whether to emit console logs on failure (default: false for quieter tests) */
  logOnFailure?: boolean;
}

/**
 * Configuration for Sleep action
 */
export interface SleepConfig extends INodeConfig {
  duration: number; // milliseconds
}

/**
 * Configuration for RunScript action
 */
export interface RunScriptConfig extends INodeConfig {
  script: string;
}

/**
 * Configuration for HttpCall action
 */
export interface HttpCallConfig extends INodeConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  saveResponseTo?: string; // Variable name to save response
}

/**
 * Logic Flow result
 */
export interface CtrlFlowResult {
  success: boolean;
  duration: number;
  logs: string[];
  errors: string[];
  variables: Record<string, any>;
}
