import fs from 'node:fs';
import path from 'node:path';
import type { AICtrlWorkflowController } from 'ai-ctrl-workflow-contract';
import type {
  AIAgentHostEffectPort,
  FrozenAIAgentTaskBinding,
  FlowClosedValue,
  AIWorkflowProfileDurableState,
} from 'ai-workflow-contract';
import {
  createFilesystemFlowRunCheckpointRuntime,
  createFilesystemFlowRunCheckpointStore,
  type FilesystemFlowRunCheckpointStore,
} from 'ai-workflow-logic/checkpoint-filesystem';
import {
  createInitialRunStepExtensions,
  normalizeFlowClosedValue,
  type FlowRunProfileAuthorityPort,
  type FlowRunProfileAuthorityRequest,
  type FrozenFlowRunProfileAuthority,
} from 'ai-workflow-logic';
import { createFilesystemFlowCodeResolver, type FlowModuleImporter } from 'instant-ctrl-flow-logic/filesystem';
import type { FlowNodeSpec } from 'instant-ctrl-flow-contract';
import { projectWorkCtrlFlowInvocationOwners } from 'work-ctrl-flow-logic';
import { assertFrozenAIAgentTaskBinding } from 'ai-workflow-logic/run-freeze';
import {
  assembleDefinitionStepProfileDirectory,
  createFilesystemDefinitionStepProfileRuntime,
} from 'flow-step-space-logic/filesystem';
import type { DefinitionStepAssemblyRuntime, DefinitionStepForest } from 'flow-step-space-logic';
import {
  loadMaterializedFlowInstance,
  materializeFlowInstance,
  type FlowInstanceSourceIdentity,
} from 'work-ctrl-flow-logic';
import type { WorkCtrlFlowSnapshot } from 'work-ctrl-flow-contract';
import {
  createAICtrlWorkflowCheckpointStore,
  createAICtrlWorkflowAgentNodeRuntimeBinder,
  createAICtrlWorkflowController,
  loadAICtrlWorkflowSources,
  type CreateAICtrlWorkflowControllerOptions,
} from './index.js';

export interface MaterializedAICtrlWorkflowControllerOptions
  extends Omit<CreateAICtrlWorkflowControllerOptions, 'binding' | 'store' | 'resolveCode'> {
  readonly storeRoot: string;
  readonly instanceId: string;
  readonly bundleDir?: string;
  readonly source?: FlowInstanceSourceIdentity;
  readonly checkpointConfig: FlowClosedValue;
  readonly durableAI: AIWorkflowProfileDurableState;
  readonly projectCheckpointOutput?: (snapshot: WorkCtrlFlowSnapshot) => FlowClosedValue;
  readonly importModule?: FlowModuleImporter;
  readonly extensionCodecs?: DefinitionStepAssemblyRuntime['extensionCodecs'];
  readonly agentEffects?: AIAgentHostEffectPort;
  readonly agentTaskProofs?: Readonly<Record<string, FrozenAIAgentTaskBinding>>;
}

export interface MaterializedAICtrlWorkflowController extends AICtrlWorkflowController {
  readonly checkpointStore: FilesystemFlowRunCheckpointStore;
  readonly profileAuthority: FlowRunProfileAuthorityPort;
  readonly extensionCodecs: DefinitionStepAssemblyRuntime['extensionCodecs'];
  readonly instanceId: string;
}

const emptyExtensionCodecs = Object.freeze({ resolve: () => undefined });

/** Frozen AICtrl definition plus canonical filesystem checkpoint owner. */
export function createMaterializedAICtrlWorkflowControllerFromDirectory(
  options: MaterializedAICtrlWorkflowControllerOptions,
): MaterializedAICtrlWorkflowController {
  if (options.agentEffects && (!options.agentTaskProofs || Object.keys(options.agentTaskProofs).length === 0)) {
    throw new Error('AI_AGENT_TASK_PROOF_REQUIRED: materialized AI Ctrl Agent effects require run-freeze task proofs.');
  }
  const extensionCodecs = options.extensionCodecs ?? emptyExtensionCodecs;
  const instancesDir = path.join(options.storeRoot, 'instances');
  const instanceDir = path.join(instancesDir, options.instanceId);
  const validateDefinition = (definitionDir: string) => {
    loadAICtrlBinding(definitionDir, extensionCodecs);
  };
  const instance = fs.existsSync(instanceDir)
    ? loadMaterializedFlowInstance(instanceDir, options.instanceId, validateDefinition)
    : options.bundleDir && options.source
      ? materializeFlowInstance({
          definitionDir: options.bundleDir,
          instancesDir,
          instanceId: options.instanceId,
          source: options.source,
          validateDefinition,
        })
      : (() => {
          if (options.bundleDir || options.source) throw new Error('bundleDir and source identity must be provided together.');
          throw new Error('bundleDir and source identity are required for first admission.');
        })();
  const binding = loadAICtrlBinding(instance.definitionDir, extensionCodecs);
  const profileAuthority = createMaterializedAICtrlWorkflowProfileAuthority({
    storeRoot: options.storeRoot,
    extensionCodecs,
  });
  const frozenProfile = profileAuthority.load({
    instanceId: options.instanceId,
    definition: instance.descriptor.definition,
    profileKind: 'AICtrlWorkflow',
  });
  const checkpointStore = createFilesystemFlowRunCheckpointStore(
    createFilesystemFlowRunCheckpointRuntime({
      storeRoot: options.storeRoot,
      extensionCodecs,
      profileAuthority,
    }),
    {},
    {},
  );
  const store = createAICtrlWorkflowCheckpointStore(
    { checkpointStore },
    {
      instanceId: options.instanceId,
      definition: instance.descriptor.definition,
      config: options.checkpointConfig,
      ai: options.durableAI,
      initialStepExtensions: createInitialRunStepExtensions(frozenProfile),
      ...(options.projectCheckpointOutput ? { projectOutput: options.projectCheckpointOutput } : {}),
    },
  );
  const {
    storeRoot: _storeRoot,
    instanceId: _instanceId,
    bundleDir: _bundleDir,
    source: _source,
    checkpointConfig: _checkpointConfig,
    durableAI: _durableAI,
    projectCheckpointOutput: _projectCheckpointOutput,
    importModule: _importModule,
    extensionCodecs: _extensionCodecs,
    agentEffects: _agentEffects,
    agentTaskProofs: _agentTaskProofs,
    ...controllerOptions
  } = options;
  const bindAgentNode=options.agentEffects?createAICtrlWorkflowAgentNodeRuntimeBinder({
    flowInstanceId:options.instanceId,
    checkpointRuntime:{checkpointStore},
    effects:options.agentEffects,
    workflowRef:`resource://${binding.definition.fqn}`,
    taskProofs:options.agentTaskProofs??{},
  }):undefined;
  const controller = createAICtrlWorkflowController({
    ...controllerOptions,
    binding,
    store,
    resolveCode: createFilesystemFlowCodeResolver(options.importModule),
    suspendDelegations: options.agentEffects?.delegation !== undefined,
    ...(bindAgentNode ? {
      // Pure branch/loop predicates have no Agent task. Keep the Agent binder
      // exact for the nodes whose frozen proof actually grants that facade.
      bindNodeRuntime:(runtime,identity)=>options.agentTaskProofs?.[identity.nodeId]?bindAgentNode(runtime,identity):runtime,
    } : {}),
  });
  const materializedController: AICtrlWorkflowController = {
    ...controller,
    async start(treeId, startOptions) {
      for (const proof of Object.values(options.agentTaskProofs ?? {})) assertFrozenAIAgentTaskBinding(proof);
      const existing = await controller.store.load(treeId);
      if (existing) {
        if (startOptions?.input !== undefined
          && JSON.stringify(startOptions.input) !== JSON.stringify(existing.input)) {
          throw new Error(`AI Ctrl Workflow run ${treeId} is already bound to different start input.`);
        }
        const outcome = await controller.getOutcome(treeId);
        if (!outcome) throw new Error(`AI Ctrl Workflow run ${treeId} has no durable outcome.`);
        return outcome;
      }
      return controller.start(treeId, startOptions);
    },
    async resume(treeId, signal) {
      for (const proof of Object.values(options.agentTaskProofs ?? {})) assertFrozenAIAgentTaskBinding(proof);
      return controller.resume(treeId, signal);
    },
  };
  return Object.assign(materializedController, {
    checkpointStore,
    profileAuthority,
    extensionCodecs,
    instanceId: options.instanceId,
  });
}

function loadAICtrlBinding(
  definitionDir: string,
  extensionCodecs: DefinitionStepAssemblyRuntime['extensionCodecs'],
) {
  const assembled = assembleDefinitionStepProfileDirectory(
    createFilesystemDefinitionStepProfileRuntime({ rootDir: definitionDir, extensionCodecs }),
    {},
    { profileRoot: 'AICtrlWorkflow' },
  );
  if (assembled.diagnostics.length > 0) {
    throw new Error(`AICtrlWorkflow StepSpace is invalid: ${assembled.diagnostics.map((item) => item.code).join(', ')}`);
  }
  const sources = Object.fromEntries((assembled.sources as readonly ({ readonly ref: string; readonly content: string } | { readonly name: string; readonly content: string })[])
    .map((source) => ['name' in source ? source.name : source.ref, source.content]));
  const loaded = loadAICtrlWorkflowSources(sources, { baseUri: definitionDir });
  if (!loaded.binding || loaded.diagnostics.length > 0) {
    throw new Error(`AICtrlWorkflow definition is invalid: ${loaded.diagnostics.map((item) => item.code).join(', ')}`);
  }
  return assembled.forest
    ? { ...loaded.binding, definition: { ...loaded.binding.definition, definitionStepForest: assembled.forest } }
    : loaded.binding;
}

function profileAuthorityFromBinding(
  binding: ReturnType<typeof loadAICtrlBinding>,
): FrozenFlowRunProfileAuthority {
  const forest = binding.definition.definitionStepForest as DefinitionStepForest | undefined;
  const definitionStepIds: string[] = [];
  const visit = (node: FlowNodeSpec): void => {
    if (node.id) definitionStepIds.push(node.id);
    node.children.forEach(visit);
    Object.values(node.sections).forEach(visit);
  };
  binding.definition.statements.forEach(visit);
  return Object.freeze({
    profileKind: 'AICtrlWorkflow' as const,
    definitionStepIds: Object.freeze([...definitionStepIds]),
    definitionInvocationOwners: projectWorkCtrlFlowInvocationOwners(binding.definition),
    extensionsByStepId: Object.freeze(Object.fromEntries((forest?.stepOrder ?? []).flatMap((stepId) => {
      const extensions = Object.fromEntries(Object.entries(forest!.steps[stepId].extensions).map(([kind, extension]) => [kind, Object.freeze({
        ...(extension.schemaRef === undefined ? {} : { schemaRef: extension.schemaRef }),
        initialValue: extension.value as import('ai-workflow-contract').FlowClosedValue,
      })]));
      return Object.keys(extensions).length === 0 ? [] : [[stepId, Object.freeze(extensions)]];
    }))),
  });
}

export function createMaterializedAICtrlWorkflowProfileAuthority(
  runtime: Pick<MaterializedAICtrlWorkflowControllerOptions, 'storeRoot' | 'extensionCodecs'>,
): FlowRunProfileAuthorityPort {
  const extensionCodecs = runtime.extensionCodecs ?? emptyExtensionCodecs;
  return Object.freeze({
    load(request: FlowRunProfileAuthorityRequest) {
      if (request.profileKind !== 'AICtrlWorkflow') {
        throw new Error(`AI Ctrl profile authority cannot load ${request.profileKind}.`);
      }
      const instanceDir = path.join(runtime.storeRoot, 'instances', request.instanceId);
      const instance = loadMaterializedFlowInstance(instanceDir, request.instanceId, (definitionDir) => {
        loadAICtrlBinding(definitionDir, extensionCodecs);
      });
      if (canonicalClosed(normalizeFlowClosedValue(instance.descriptor.definition, 'profileAuthority.instanceDefinition'))
        !== canonicalClosed(normalizeFlowClosedValue(request.definition, 'profileAuthority.requestDefinition'))) {
        throw new Error('AI Ctrl profile authority definition identity differs from the checkpoint.');
      }
      return profileAuthorityFromBinding(loadAICtrlBinding(instance.definitionDir, extensionCodecs));
    },
  });
}

const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function canonicalClosed(value: import('ai-workflow-contract').FlowClosedValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalClosed).join(',')}]`;
  const record = value as import('ai-workflow-contract').FlowClosedObject;
  return `{${Object.keys(record).sort(compareCodeUnits).map((key) => (
    `${JSON.stringify(key)}:${canonicalClosed(record[key])}`
  )).join(',')}}`;
}
