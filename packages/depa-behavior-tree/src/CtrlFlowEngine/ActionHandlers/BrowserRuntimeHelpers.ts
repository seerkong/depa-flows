import { ExecutionContext, INodeConfig } from '../../BehaviorTreeCore/types';
import { CtrlFlowNodeType } from '../types';

// ---------------------------------------------------------------------------
// Browser-specific config types (moved here from types.ts)
// These are used only by browser extension handlers.
// ---------------------------------------------------------------------------

export type BrowserSelectorType = 'css' | 'xpath' | 'role';

export interface BrowserSelectorConfig {
  type: BrowserSelectorType;
  value: string;
  name?: string;
  exact?: boolean;
}

export interface BrowserRetryConfig {
  maxRetries?: number;
  retryInterval?: number;
  waitBeforeRetry?: boolean;
}

export interface NavigateConfig extends INodeConfig {
  url: string;
}

export interface ClickConfig extends INodeConfig {
  selector: BrowserSelectorConfig;
  retry?: BrowserRetryConfig;
}

export interface FillConfig extends INodeConfig {
  selector: BrowserSelectorConfig;
  value: string;
  retry?: BrowserRetryConfig;
}

export interface WaitForElementConfig extends INodeConfig {
  selector: BrowserSelectorConfig;
  timeout?: number;
  interval?: number;
}

export interface SelectElementConfig extends INodeConfig {
  selector: BrowserSelectorConfig;
  checked: boolean;
  retry?: BrowserRetryConfig;
}

export interface WaitTimeConfig extends INodeConfig {
  duration: number;
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

export interface BrowserSideEffectLike {
  navigateTo?: (url: string) => Promise<unknown> | unknown;
  waitForPageLoad?: (options?: { timeout?: number }) => Promise<unknown> | unknown;
  clickElement?: (
    selector: BrowserSelectorConfig,
    retry?: BrowserRetryConfig
  ) => Promise<unknown> | unknown;
  fillInput?: (
    selector: BrowserSelectorConfig,
    value: string,
    retry?: BrowserRetryConfig
  ) => Promise<unknown> | unknown;
  waitForElement?: (
    selector: BrowserSelectorConfig,
    options?: { timeout?: number; interval?: number }
  ) => Promise<unknown> | unknown;
  selectElement?: (
    selector: BrowserSelectorConfig,
    checked: boolean,
    retry?: BrowserRetryConfig
  ) => Promise<unknown> | unknown;
  wait?: (ms: number) => Promise<unknown> | unknown;
}

export interface BrowserRuntimeLike {
  sideEffect?: BrowserSideEffectLike;
  options?: {
    defaultRetry?: BrowserRetryConfig;
    defaultTimeout?: number;
  };
  outerCtx?: {
    params?: Record<string, unknown>;
  };
}

export function getBrowserRuntime(runtime: unknown): BrowserRuntimeLike | null {
  if (!runtime || typeof runtime !== 'object') {
    return null;
  }
  return runtime as BrowserRuntimeLike;
}

export function resolveTemplateValue(
  value: string,
  context: ExecutionContext<CtrlFlowNodeType, any>
): string {
  const runtime = getBrowserRuntime(context.runtime);

  return value.replace(/\$\{([^}]+)\}/g, (full, varNameRaw: string) => {
    const varName = varNameRaw.trim();
    const fromVars = context.getVar(varName);
    if (fromVars !== undefined) {
      return String(fromVars);
    }

    const fromParams = runtime?.outerCtx?.params?.[varName];
    if (fromParams !== undefined) {
      return String(fromParams);
    }

    return full;
  });
}

export function getDefaultTimeout(runtime: BrowserRuntimeLike | null, fallback = 30000): number {
  return runtime?.options?.defaultTimeout ?? fallback;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function setNodeError(
  context: ExecutionContext<CtrlFlowNodeType, any>,
  error: unknown,
  fallback = 'Unknown browser action error'
): void {
  const message = toErrorMessage(error) || fallback;
  context.node.Attr = {
    ...(context.node.Attr ?? {}),
    error: message,
  };
}
