import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AIWorkflowStateProjection } from 'ai-workflow-contract';
import { mutateRunStepExtension } from 'ai-workflow-logic';
import { freezeAIWorkflowRunResourcesFromDirectory, projectFrozenAIAgentTaskBinding } from 'ai-workflow-logic/run-freeze';
import {
  createMaterializedAICtrlWorkflowControllerFromDirectory,
  type MaterializedAICtrlWorkflowController,
} from 'ai-ctrl-workflow-logic/filesystem';

describe('materialized AI Ctrl canonical execution', () => {
  test('keeps a frozen Ctrl extension through targeted mutation, processor save and fresh recovery', async () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ctrl-extension-'));
    const source = path.join(storeRoot, 'source');
    fs.mkdirSync(path.join(source, 'steps', 'prepare'), { recursive: true });
    fs.mkdirSync(path.join(source, 'steps', 'hold'), { recursive: true });
    fs.mkdirSync(path.join(source, 'steps', 'done'), { recursive: true });
    fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AICtrlWorkflow #depa.flows.test.CtrlExtension apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.CtrlExtension>
      <StepSpaceRef { src = "step-space.xnl" }>
    )>`);
    fs.writeFileSync(path.join(source, 'step-space.xnl'), `<StepSpace #depa.flows.test.CtrlExtensionSteps [
      <StepRef #prepare { src = "steps/prepare/step.xnl" }>
      <StepRef #hold { src = "steps/hold/step.xnl" }>
      <StepRef #done { src = "steps/done/step.xnl" }>
    ]>`);
    fs.writeFileSync(path.join(source, 'steps', 'prepare', 'step.xnl'), `<Step #prepare (
      <Core [ <Run #prepare { src = "vfs://./flow-code.ts#prepare" }> ]>
      <Extensions [
        <ExtensionRef {
          kind = "depa.test.ctrl-review-policy"
          src = "steps/prepare/review-policy.xnl"
          schema = "schema://depa.test.ctrl-review-policy/v1"
        }>
      ]>
    )>`);
    fs.writeFileSync(path.join(source, 'steps', 'prepare', 'review-policy.xnl'), `<StepExtension #prepare-review-policy {
      kind = "depa.test.ctrl-review-policy"
      schema = "schema://depa.test.ctrl-review-policy/v1"
      value = { reviewDepth = 1 audience = "operator" }
    }>`);
    fs.writeFileSync(path.join(source, 'steps', 'hold', 'step.xnl'), `<Step #hold (
      <Core [ <ExternalJob #hold { signalKind = "work.completed" signalKey = "review" }> ]>
    )>`);
    fs.writeFileSync(path.join(source, 'steps', 'done', 'step.xnl'), '<Step #done ( <Core [ <Return #done> ]> )>');
    fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export const fixture = true;\n');

    const extensionCodecs = Object.freeze({
      resolve(kind: string) {
        return kind === 'depa.test.ctrl-review-policy' ? {
          schemaRef: 'schema://depa.test.ctrl-review-policy/v1',
          codec: {
            normalize(value: unknown) {
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('review policy must be an object');
              const policy = value as { readonly reviewDepth?: unknown; readonly audience?: unknown };
              if (!Number.isSafeInteger(policy.reviewDepth) || (policy.reviewDepth as number) < 0) {
                throw new Error('reviewDepth must be a non-negative integer');
              }
              if (typeof policy.audience !== 'string' || !policy.audience) throw new Error('audience is required');
              return { reviewDepth: policy.reviewDepth as number, audience: policy.audience };
            },
          },
        } : undefined;
      },
    });
    const projection: AIWorkflowStateProjection = { async loadRunState() { return undefined; } };
    let controller!: MaterializedAICtrlWorkflowController;
    let mutationCalls = 0;
    const create = (admit: boolean) => createMaterializedAICtrlWorkflowControllerFromDirectory({
      storeRoot,
      instanceId: 'ctrl-extension-instance',
      ...(admit ? {
        bundleDir: source,
        source: { revision: 'r1', provenance: { authority: 'resource-package', artifactRef: 'resource://test/CtrlExtension' } },
      } : {}),
      extensionCodecs,
      checkpointConfig: {},
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      ai: {
        roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
        effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
        stateStore: projection,
      },
      importModule: async () => ({
        prepare: async (_runtime: unknown, input: unknown) => {
          mutationCalls += 1;
          await mutateRunStepExtension({
            checkpointStore: controller.checkpointStore,
            profileAuthority: controller.profileAuthority,
            extensionCodecs: controller.extensionCodecs,
          }, {
            instanceId: controller.instanceId,
            runId: 'ctrl-extension-run',
            stepId: 'prepare',
            kind: 'depa.test.ctrl-review-policy',
          }, {
            expectedRevision: 0,
            value: { reviewDepth: 3, audience: 'review-board' },
          }, {});
          return input;
        },
      }),
    });

    const missingCodecRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ctrl-extension-missing-codec-'));
    expect(() => createMaterializedAICtrlWorkflowControllerFromDirectory({
      storeRoot: missingCodecRoot,
      instanceId: 'missing-codec-instance',
      bundleDir: source,
      source: { revision: 'r1', provenance: { authority: 'resource-package', artifactRef: 'resource://test/CtrlExtension' } },
      checkpointConfig: {},
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      ai: {
        roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
        effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
        stateStore: projection,
      },
    })).toThrow();
    expect(fs.existsSync(path.join(missingCodecRoot, 'instances', 'missing-codec-instance', 'runs'))).toBe(false);

    controller = create(true);
    const waiting = await controller.start('ctrl-extension-run', { input: { request: 'review' } });
    expect(waiting.status).toBe('Waiting');
    expect(mutationCalls).toBe(1);
    const afterProcessorSave = await controller.checkpointStore.load({
      instanceId: controller.instanceId,
      runId: 'ctrl-extension-run',
    });
    expect(afterProcessorSave?.stepExtensions?.byStepId.prepare['depa.test.ctrl-review-policy']).toEqual({
      schemaRef: 'schema://depa.test.ctrl-review-policy/v1',
      revision: 1,
      value: { audience: 'review-board', reviewDepth: 3 },
    });

    const beforeWrongAuthority = afterProcessorSave!.version;
    await expect(mutateRunStepExtension({
      checkpointStore: controller.checkpointStore,
      extensionCodecs: controller.extensionCodecs,
      profileAuthority: {
        load(request) {
          const authority = controller.profileAuthority.load(request);
          return { ...authority, profileKind: 'AIDataWorkflow' };
        },
      },
    }, {
      instanceId: controller.instanceId,
      runId: 'ctrl-extension-run',
      stepId: 'prepare',
      kind: 'depa.test.ctrl-review-policy',
    }, {
      expectedRevision: 1,
      value: { reviewDepth: 4, audience: 'review-board' },
    }, {})).rejects.toThrow();
    expect((await controller.checkpointStore.load({
      instanceId: controller.instanceId,
      runId: 'ctrl-extension-run',
    }))?.version).toBe(beforeWrongAuthority);

    const fresh = create(false);
    const handle = waiting.openWaitHandles[0];
    const completed = await fresh.resume('ctrl-extension-run', {
      signalKind: handle.signalKind,
      signalKey: handle.signalKey,
      resumeToken: handle.resumeToken,
    });
    expect(completed.status).toBe('Completed');
    const recovered = await fresh.checkpointStore.load({
      instanceId: fresh.instanceId,
      runId: 'ctrl-extension-run',
    });
    expect(recovered?.stepExtensions?.byStepId.prepare['depa.test.ctrl-review-policy']).toEqual({
      schemaRef: 'schema://depa.test.ctrl-review-policy/v1',
      revision: 1,
      value: { audience: 'review-board', reviewDepth: 3 },
    });
    expect(mutationCalls).toBe(1);
  });

  test('keeps a linked AI Ctrl instances boundary outside the support root unchanged', () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ctrl-boundary-'));
    const source = path.join(storeRoot, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AICtrlWorkflow #depa.flows.test.CtrlBoundary apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.CtrlBoundary>
    ) [<Return #done>]>`);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ctrl-external-'));
    const marker = path.join(external, 'marker.txt');
    fs.writeFileSync(marker, 'unchanged');
    fs.symlinkSync(external, path.join(storeRoot, 'instances'));

    expect(() => createMaterializedAICtrlWorkflowControllerFromDirectory({
      storeRoot,
      instanceId: 'linked-ctrl-instance',
      bundleDir: source,
      source: {
        revision: 'ctrl-r1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/ctrl-boundary' },
      },
      checkpointConfig: {},
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      ai: {
        roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
        effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } },
        stateStore: { async loadRunState() { return undefined; } },
      },
    })).toThrow();
    expect(fs.readFileSync(marker, 'utf8')).toBe('unchanged');
    expect(fs.readdirSync(external)).toEqual(['marker.txt']);
  });

  test('runs from a frozen definition and recovers through one filesystem checkpoint', async () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ctrl-canonical-'));
    const source = path.join(storeRoot, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AICtrlWorkflow #depa.flows.test.MaterializedCtrl apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.MaterializedCtrl>
    ) [
      <Run #prepare { src = "vfs://./flow-code.ts#prepare" }>
      <ExternalJob #hold { signalKind = "work.completed" signalKey = "review" }>
      <Return #done>
    ]>`);
    fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export function prepare(runtime, input, config) { return input; }\n');
    const stateProjection: AIWorkflowStateProjection = {
      async loadRunState() { return undefined; },
    };
    const effects = { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } };
    let observedV0 = false;
    const create = (admission: boolean, verifyV0 = true) => createMaterializedAICtrlWorkflowControllerFromDirectory({
      storeRoot,
      instanceId: 'ctrl-instance',
      ...(admission ? {
        bundleDir: source,
        source: {
          revision: 'ctrl-r1',
          provenance: { authority: 'resource-package', artifactRef: 'resource://flow/materialized-ctrl' },
        },
      } : {}),
      checkpointConfig: { mode: 'standard' },
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      ai: {
        roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' },
        effects,
        stateStore: stateProjection,
      },
      runtime: { observeCheckpoint: () => undefined },
      importModule: async () => ({
        prepare: (_runtime: unknown, input: unknown) => {
          if (!verifyV0) return input;
          const checkpoint = JSON.parse(fs.readFileSync(path.join(
            storeRoot, 'instances', 'ctrl-instance', 'runs', 'ctrl-run', 'checkpoint.json',
          ), 'utf8')) as { schemaVersion: string; version: number; runStepStateRootDigest: string };
          expect(checkpoint.version).toBe(0);
          expect(checkpoint.schemaVersion).toBe('depa.flow-run-checkpoint-head/v1');
          expect(checkpoint.runStepStateRootDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
          observedV0 = true;
          return input;
        },
      }),
    });

    const waiting = await create(true).start('ctrl-run', { input: { request: 'review' } });
    expect(waiting.status).toBe('Waiting');
    expect(observedV0).toBe(true);
    const originalBytes = fs.readFileSync(path.join(
      storeRoot, 'instances', 'ctrl-instance', 'definition', 'manifest.xnl',
    ));
    fs.writeFileSync(path.join(source, 'manifest.xnl'), '<AICtrlWorkflow');

    const handle = waiting.openWaitHandles[0];
    const completed = await create(false).resume('ctrl-run', {
      signalKind: handle.signalKind,
      signalKey: handle.signalKey,
      resumeToken: handle.resumeToken,
    });
    expect(completed.status).toBe('Completed');
    fs.rmSync(source, { recursive: true });
    const frozenWithAdmissionInput = create(true, false);
    expect((await frozenWithAdmissionInput.start('ctrl-run', { input: { request: 'review' } })).status).toBe('Completed');
    expect((await frozenWithAdmissionInput.start('ctrl-run-2', { input: { request: 'second' } })).status).toBe('Waiting');
    expect(fs.readFileSync(path.join(
      storeRoot, 'instances', 'ctrl-instance', 'definition', 'manifest.xnl',
    ))).toEqual(originalBytes);
  });

  for(const entry of ['legacy','node-task'] as const)test(`reuses a named Agent through ordinary Run nodes after fresh resume (${entry})`, async () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ctrl-agent-facade-'));
    const source = path.join(storeRoot, 'source');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'manifest.xnl'), `<AICtrlWorkflow #depa.flows.test.Workflow.Support apiVersion="depa.flows/v1" version="1" (
      <FlowContract #depa.flows.test.Workflow.Support>
    ) [
      <Run #collect-request { src = "vfs://./flow-code.ts#collectRequest" config = { agentDefinitionRef = "resource://depa.flows.test.Agent.Support" instanceName = "reviewer" } }>
      <ExternalJob #hold { signalKind = "work.completed" signalKey = "review" }>
      <Return #done>
    ]>`);
    fs.writeFileSync(path.join(source, 'flow-code.ts'), 'export const fixture = true;\n');
    const projection: AIWorkflowStateProjection = { async loadRunState() { return undefined; } };
    let newCalls = 0;
    const agentEffects = {
      async runAgent() { newCalls += 1; return { output: { text: 'draft' }, instance: { authority: 'eidolon', instanceId: 'agent-1', instanceName: 'reviewer' } }; },
      async runTargetedAgent(request: any) { return { output: { text: 'refined' }, instance: request.instance }; },
    };
    const receipt = await freezeAIWorkflowRunResourcesFromDirectory(
      path.join(import.meta.dir, '../../ai-workflow-logic/test/fixtures/HalfcodeAIAgentResourcePackage'),
      { workflowKind: 'AICtrlWorkflow', workflowRef: 'resource://depa.flows.test.Workflow.Support', nodeId: 'collect-request', agentDefinitionRef: 'resource://depa.flows.test.Agent.Support' },
    );
    const taskProofs = { 'collect-request': projectFrozenAIAgentTaskBinding(receipt) } as const;
    const create = (admit: boolean, proofs: typeof taskProofs | null = taskProofs) => createMaterializedAICtrlWorkflowControllerFromDirectory({
      storeRoot,
      instanceId: 'agent-ctrl-instance',
      ...(admit ? { bundleDir: source, source: { revision: 'r1', provenance: { authority: 'resource-package', artifactRef: 'resource://demo.Flow' } } } : {}),
      checkpointConfig: {},
      durableAI: { schemaVersion: 'depa.ai-agent-state/v1', instancesById: {}, instanceIdByName: {}, invocationsByKey: {} },
      ai: { roots: { globalRoot: 'vfs://global', workspaceRoot: 'vfs://workspace' }, effects: { async invoke<Input, Output>(): Promise<Output> { return undefined as Output; } }, stateStore: projection },
      agentEffects,
      agentTaskProofs: proofs ?? undefined,
      importModule: async () => ({
        collectRequest: (nodeRuntime: any, input: any, config: any) => entry==='node-task'?nodeRuntime.ai.tasks.invoke(input,config):nodeRuntime.ai.effects.runAgent(input, config),
      }),
    });
    expect(() => create(true, null)).toThrow('AI_AGENT_TASK_PROOF_REQUIRED');
    expect(newCalls).toBe(0);
    await expect(create(true, { 'collect-request': { ...taskProofs['collect-request'] } }).start('forged-proof-run', { input: { request: 'subject' } }))
      .rejects.toThrow();
    expect(newCalls).toBe(0);
    const waiting = await create(true).start('agent-ctrl-run', { input: { request: 'subject' } });
    expect(waiting.status).toBe('Waiting');
    const handle = waiting.openWaitHandles[0];
    const completed = await create(false).resume('agent-ctrl-run', { signalKind: handle.signalKind, signalKey: handle.signalKey, resumeToken: handle.resumeToken });
    expect(completed.status).toBe('Completed');
    expect(newCalls).toBe(1);
    expect((await create(false).start('agent-ctrl-run', { input: { request: 'subject' } })).status).toBe('Completed');
    expect(newCalls).toBe(1);
  });
});
