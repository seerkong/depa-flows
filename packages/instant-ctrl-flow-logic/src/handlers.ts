import {
  BehaviorResult,
  type ActionHandler,
  type CtrlFlowNodeType,
  type ExecutionContext,
  type INodeConfig,
} from 'depa-behavior-tree';
import type {
  FlowBundleSpec,
  FlowCodeFunction,
  FlowCodeResolver,
  FlowNodeSpec,
  InstantCtrlFlowRuntime,
} from 'instant-ctrl-flow-contract';

type Ctx = ExecutionContext<CtrlFlowNodeType, INodeConfig>;

export const FLOW_STATE_KEY = '__flow_execution__';

export interface FlowExecutionState {
  current: unknown;
  returned: boolean;
  output?: unknown;
  fault?: unknown;
  selections: Record<string, string>;
  fallbackInputs: Record<string, unknown>;
  untilIterations: Record<string, number>;
  untilValues: Record<string, boolean>;
}

export const createFlowExecutionState = (input: unknown): FlowExecutionState => ({
  current: input,
  returned: false,
  selections: {},
  fallbackInputs: {},
  untilIterations: {},
  untilValues: {},
});

export const flowStateOf = (ctx: Ctx): FlowExecutionState => ctx.getVar(FLOW_STATE_KEY) as FlowExecutionState;

type NodeConfig = {
  src?: string;
  config?: Readonly<Record<string, unknown>>;
  hasValue?: boolean;
  value?: unknown;
  ifPath?: string;
  branchKey?: string;
  decisionKind?: FlowBranchDecisionKind;
  fallbackKey?: string;
  predicateKey?: string;
  countIteration?: boolean;
  maxIterations?: number;
  statements?: FlowNodeSpec[];
  items?: { id?: string; statements: FlowNodeSpec[] }[];
  flow?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  concurrency?: number;
  mode?: string;
};

export type FlowBodyExecutor = (
  statements: FlowNodeSpec[],
  input: unknown,
  runtime: InstantCtrlFlowRuntime,
  signal?: AbortSignal,
) => Promise<unknown>;

export type FlowTargetExecutor = (
  reference: string,
  input: unknown,
  runtime: InstantCtrlFlowRuntime,
  signal?: AbortSignal,
) => Promise<unknown>;

export type FlowBranchDecisionKind = 'Branch' | 'Otherwise' | 'NoMatch';

export interface FlowBranchDecision {
  ifPath: string;
  invocationKey: string;
  kind: FlowBranchDecisionKind;
  branchKey?: string;
}

export interface FlowDecisionContext {
  ifPath: string;
  invocationKey: string;
  decision?: FlowBranchDecision;
}

/** Optional persistence boundary used by replaying profiles; InstantCtrlFlow leaves it undefined. */
export interface FlowDecisionHooks {
  begin(ifPath: string): FlowDecisionContext;
  record(decision: FlowBranchDecision): Promise<void> | void;
  runtimeForNode?(nodeId: string, runtime: InstantCtrlFlowRuntime): InstantCtrlFlowRuntime;
}

class FlowFunctionLoader {
  private cache = new Map<string, Promise<FlowCodeFunction>>();
  constructor(
    private spec: FlowBundleSpec,
    private resolveCode: FlowCodeResolver,
    private runtimeHooks?: FlowDecisionHooks,
  ) {}

  runtimeForNode(nodeId: string, runtime: InstantCtrlFlowRuntime): InstantCtrlFlowRuntime {
    return this.runtimeHooks?.runtimeForNode?.(nodeId, runtime) ?? runtime;
  }

  load(src: string, nodeId: string): Promise<FlowCodeFunction> {
    let loaded = this.cache.get(src);
    if (!loaded) {
      loaded = (async () => {
        const fn = await this.resolveCode({
          reference: src,
          flowId: this.spec.fqn,
          nodeId,
          baseUri: this.spec.baseUri,
        });
        if (typeof fn !== 'function') throw new Error(`vfs src "${src}" does not export a function`);
        return fn;
      })();
      this.cache.set(src, loaded);
    }
    return loaded;
  }
}

function configOf(ctx: Ctx): NodeConfig {
  return ctx.node.Config as NodeConfig;
}

async function callCode(ctx: Ctx, loader: FlowFunctionLoader, src: string): Promise<unknown> {
  const state = flowStateOf(ctx);
  const fn = await loader.load(src, ctx.node.Key);
  const runtime = (ctx.runtime ?? {}) as InstantCtrlFlowRuntime;
  return fn(loader.runtimeForNode(ctx.node.Key, runtime), state.current, configOf(ctx).config ?? {});
}

function fail(state: FlowExecutionState, error: unknown): BehaviorResult {
  state.fault = error;
  return BehaviorResult.Failure;
}

class RunHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(private loader: FlowFunctionLoader) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    if (state.returned) return BehaviorResult.Success;
    if (state.fault) return BehaviorResult.Failure;
    try {
      state.current = await callCode(ctx, this.loader, String(configOf(ctx).src ?? ''));
      return BehaviorResult.Success;
    } catch (error) {
      return fail(state, error);
    }
  }
}

class ReturnHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(private loader: FlowFunctionLoader) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    if (state.returned) return BehaviorResult.Success;
    if (state.fault) return BehaviorResult.Failure;
    const config = configOf(ctx);
    try {
      const output = config.src
        ? await callCode(ctx, this.loader, config.src)
        : config.hasValue
          ? config.value
          : state.current;
      state.current = output;
      state.output = output;
      state.returned = true;
      return BehaviorResult.Success;
    } catch (error) {
      return fail(state, error);
    }
  }
}

class IfStartHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(
    private decisionHooks: FlowDecisionHooks | undefined,
    private activeDecisions: Map<string, FlowDecisionContext>,
  ) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    if (state.returned) return BehaviorResult.Success;
    if (state.fault) return BehaviorResult.Failure;
    const ifPath = String(configOf(ctx).ifPath);
    delete state.selections[ifPath];
    if (this.decisionHooks) this.activeDecisions.set(ifPath, this.decisionHooks.begin(ifPath));
    return BehaviorResult.Success;
  }
}

class PredicateHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(
    private loader: FlowFunctionLoader,
    private decisionHooks: FlowDecisionHooks | undefined,
    private activeDecisions: Map<string, FlowDecisionContext>,
  ) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    if (state.returned) return BehaviorResult.Success;
    if (state.fault) return BehaviorResult.Failure;
    const config = configOf(ctx);
    const ifPath = String(config.ifPath);
    const branchKey = String(config.branchKey);
    const decisionContext = this.activeDecisions.get(ifPath);
    if (decisionContext?.decision) {
      return decisionContext.decision.kind === 'Branch' && decisionContext.decision.branchKey === branchKey
        ? BehaviorResult.Success
        : BehaviorResult.Failure;
    }
    if (state.selections[ifPath]) return BehaviorResult.Failure;
    try {
      const result = await callCode(ctx, this.loader, String(config.src ?? ''));
      if (typeof result !== 'boolean') throw new TypeError(`predicate ${config.src} must return boolean`);
      if (!result) return BehaviorResult.Failure;
      if (this.decisionHooks && decisionContext) {
        const decision: FlowBranchDecision = {
          ifPath,
          invocationKey: decisionContext.invocationKey,
          kind: 'Branch',
          branchKey,
        };
        await this.decisionHooks.record(decision);
        decisionContext.decision = decision;
      }
      state.selections[ifPath] = branchKey;
      return BehaviorResult.Success;
    } catch (error) {
      return fail(state, error);
    }
  }
}

class OtherwiseHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(
    private decisionHooks: FlowDecisionHooks | undefined,
    private activeDecisions: Map<string, FlowDecisionContext>,
  ) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    if (state.returned) return BehaviorResult.Success;
    const config = configOf(ctx);
    const ifPath = String(config.ifPath);
    const kind = config.decisionKind ?? 'Otherwise';
    const branchKey = config.branchKey;
    const decisionContext = this.activeDecisions.get(ifPath);
    if (state.fault) return BehaviorResult.Failure;
    if (decisionContext?.decision) {
      const selected = decisionContext.decision;
      return selected.kind === kind && selected.branchKey === branchKey
        ? BehaviorResult.Success
        : BehaviorResult.Failure;
    }
    if (state.selections[ifPath]) return BehaviorResult.Failure;
    if (this.decisionHooks && decisionContext) {
      try {
        const decision: FlowBranchDecision = {
          ifPath,
          invocationKey: decisionContext.invocationKey,
          kind,
          ...(branchKey === undefined ? {} : { branchKey }),
        };
        await this.decisionHooks.record(decision);
        decisionContext.decision = decision;
      } catch (error) {
        return fail(state, error);
      }
    }
    return BehaviorResult.Success;
  }
}

class StrategyStartHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    if (state.returned) return BehaviorResult.Success;
    const key = String(configOf(ctx).fallbackKey);
    state.current = state.fallbackInputs[key];
    delete state.fault;
    return BehaviorResult.Success;
  }
}

class FallbackStartHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    if (state.returned) return BehaviorResult.Success;
    const key = String(configOf(ctx).fallbackKey);
    state.fallbackInputs[key] = state.current;
    delete state.fault;
    return BehaviorResult.Success;
  }
}

class UntilPredicateHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(private loader: FlowFunctionLoader) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    const config = configOf(ctx);
    const key = String(config.predicateKey);
    if (state.returned) {
      state.untilValues[key] = true;
      return BehaviorResult.Success;
    }
    if (state.fault) return BehaviorResult.Failure;
    try {
      const result = await callCode(ctx, this.loader, String(config.src ?? ''));
      if (typeof result !== 'boolean') throw new TypeError(`predicate ${config.src} must return boolean`);
      if (config.countIteration) {
        const iterations = (state.untilIterations[key] ?? 0) + 1;
        state.untilIterations[key] = iterations;
        if (!result && iterations >= Number(config.maxIterations ?? 9999)) {
          return fail(state, new Error(`Until node exceeded max iterations (${config.maxIterations})`));
        }
      }
      state.untilValues[key] = result;
      return BehaviorResult.Success;
    } catch (error) {
      return fail(state, error);
    }
  }
}

class RequireHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(private loader: FlowFunctionLoader) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    try {
      const result = await callCode(ctx, this.loader, String(configOf(ctx).src ?? ''));
      if (typeof result !== 'boolean') throw new TypeError('Require predicate must return boolean');
      if (!result) throw new Error(`precondition failed at #${ctx.node.Key}`);
      return BehaviorResult.Success;
    } catch (error) {
      return fail(state, error);
    }
  }
}

class CompositeHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(
    private kind: 'Retry' | 'Timeout' | 'ForEach' | 'Parallel' | 'Race',
    private loader: FlowFunctionLoader,
    private executeBody: FlowBodyExecutor,
  ) {}

  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    const config = configOf(ctx);
    const runtime = (ctx.runtime ?? {}) as InstantCtrlFlowRuntime;
    try {
      if (this.kind === 'Retry') {
        const attempts = Math.max(1, Number(config.maxAttempts ?? 1));
        let lastError: unknown;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            state.current = await this.executeBody(config.statements ?? [], state.current, runtime);
            return BehaviorResult.Success;
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      }
      if (this.kind === 'Timeout') {
        const controller = new AbortController();
        const timeoutMs = Math.max(0, Number(config.timeoutMs ?? 0));
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          state.current = await Promise.race([
            this.executeBody(config.statements ?? [], state.current, runtime, controller.signal),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error(`Timeout #${ctx.node.Key} exceeded ${timeoutMs}ms`));
              }, timeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        return BehaviorResult.Success;
      }
      if (this.kind === 'ForEach') {
        const selected = await callCode(ctx, this.loader, String(config.src ?? configOf(ctx).src ?? ''));
        if (!Array.isArray(selected)) throw new TypeError('ForEach selector must return an array');
        const outputs: unknown[] = [];
        for (const item of selected) outputs.push(await this.executeBody(config.statements ?? [], item, runtime));
        state.current = outputs;
        return BehaviorResult.Success;
      }

      const items = config.items ?? [];
      const controllers = items.map(() => new AbortController());
      const executions = items.map((item, index) =>
        this.executeBody(item.statements, state.current, runtime, controllers[index].signal)
          .then((value) => ({ id: item.id ?? String(index), value })),
      );
      if (this.kind === 'Parallel') {
        const values = await Promise.all(executions);
        state.current = Object.fromEntries(values.map(({ id, value }) => [id, value]));
        return BehaviorResult.Success;
      }

      const mode = config.mode ?? 'first-success';
      const winner = mode === 'first-completed'
        ? await Promise.race(executions)
        : await Promise.any(executions);
      controllers.forEach((controller) => controller.abort());
      state.current = { winner: winner.id, output: winner.value };
      return BehaviorResult.Success;
    } catch (error) {
      return fail(state, error);
    }
  }
}

class CallFlowHandler implements ActionHandler<CtrlFlowNodeType, INodeConfig> {
  constructor(private executeTarget?: FlowTargetExecutor) {}
  async execute(ctx: Ctx): Promise<BehaviorResult> {
    const state = flowStateOf(ctx);
    try {
      if (!this.executeTarget) throw new Error('CallFlow requires a CtrlFlow resolver');
      state.current = await this.executeTarget(
        String(configOf(ctx).flow ?? ''),
        state.current,
        (ctx.runtime ?? {}) as InstantCtrlFlowRuntime,
      );
      return BehaviorResult.Success;
    } catch (error) {
      return fail(state, error);
    }
  }
}

export function createFlowHandlers(
  spec: FlowBundleSpec,
  resolveCode: FlowCodeResolver,
  decisionHooks?: FlowDecisionHooks,
  executeBody?: FlowBodyExecutor,
  executeTarget?: FlowTargetExecutor,
): Record<string, ActionHandler<CtrlFlowNodeType, INodeConfig>> {
  const loader = new FlowFunctionLoader(spec, resolveCode, decisionHooks);
  const activeDecisions = new Map<string, FlowDecisionContext>();
  return {
    'flow.Run': new RunHandler(loader),
    'flow.Return': new ReturnHandler(loader),
    'flow.IfStart': new IfStartHandler(decisionHooks, activeDecisions),
    'flow.Predicate': new PredicateHandler(loader, decisionHooks, activeDecisions),
    'flow.Otherwise': new OtherwiseHandler(decisionHooks, activeDecisions),
    'flow.FallbackStart': new FallbackStartHandler(),
    'flow.StrategyStart': new StrategyStartHandler(),
    'flow.UntilPredicate': new UntilPredicateHandler(loader),
    'flow.Require': new RequireHandler(loader),
    ...(executeBody ? {
      'flow.Retry': new CompositeHandler('Retry', loader, executeBody),
      'flow.Timeout': new CompositeHandler('Timeout', loader, executeBody),
      'flow.ForEach': new CompositeHandler('ForEach', loader, executeBody),
      'flow.Parallel': new CompositeHandler('Parallel', loader, executeBody),
      'flow.Race': new CompositeHandler('Race', loader, executeBody),
    } : {}),
    'flow.CallFlow': new CallFlowHandler(executeTarget),
  };
}
