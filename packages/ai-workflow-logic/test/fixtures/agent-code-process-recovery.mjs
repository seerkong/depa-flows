// Spawned explicitly by agent-code-process-recovery.test.ts; never loaded as a Bun test.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  composeLayeredResourceRegistry,
  createDirectoryResourcePackageReadPort,
  digestCanonical,
  loadResourceTree,
} from 'halfcode-compiler.xnl/resource-core';
import { projectAIWorkflowAgentResources, resolveAIAgentExecutionResources } from 'ai-workflow-logic';
import {
  createAIWorkflowResourceResolutionContext,
} from 'ai-workflow-logic/filesystem';
import { createReaderProfile, KindReaderRegistry } from 'halfcode-compiler.xnl/kind-definition';
import {
  compileAgentContextPipeline,
  restoreAIAgentCodeExecution,
} from 'ai-workflow-logic/agent-code-execution';
import {
  assertFrozenAIAgentTaskBinding,
  freezeAIWorkflowRunResources,
  projectFrozenAIAgentTaskBinding,
} from 'ai-workflow-logic/run-freeze';

const contextId = 'depa.flows.test.ContextPipeline.Standard';
const environment = { hostIdentity: 'cross-process-context/v1', ambient: {} };
const task = {
  workflowKind: 'AICtrlWorkflow',
  workflowRef: 'resource://depa.flows.test.Workflow.Support',
  nodeId: 'collect-request',
  agentDefinitionRef: 'resource://depa.flows.test.Agent.Support',
};

function readerContext(tree, revisedReader) {
  const context = createAIWorkflowResourceResolutionContext(undefined, tree);
  if (!revisedReader) return context;
  const readers = new KindReaderRegistry();
  const revised = reader => reader.subjectFqn.endsWith('.AgentContextPipeline')
    ? { ...reader, readerImplementationFingerprint: digestCanonical({
        original: reader.readerImplementationFingerprint, revision: 'process-reader/v2',
      }) }
    : reader;
  for (const reader of context.readers.all()) readers.register(revised(reader));
  return {
    ...context,
    readers,
    // Keep profile id, reader id, spec and behavior the same: only implementation identity changes.
    readerProfile: createReaderProfile(context.readerProfile.profileId,
      [...context.readerProfile.readers.values()].map(revised)),
  };
}

async function observe(resourceRoot, revisedReader = false) {
  const tree = await loadResourceTree({ rootDir: resourceRoot });
  const layers = [{ id: 'workspace', tree }];
  const authoredRegistry = composeLayeredResourceRegistry({ layers });
  const executionResources = resolveAIAgentExecutionResources({
    resolutionContexts: new Map([['workspace', readerContext(tree, revisedReader)]]),
  }, { registry: authoredRegistry, layers });
  const code = executionResources.projection.codeResources.find(item => item.resource.resourceId === contextId);
  assert.equal(code.mode, 'native');
  return {
    registry: authoredRegistry,
    projection: projectAIWorkflowAgentResources(authoredRegistry),
    code,
    contentIdentities: executionResources.contentIdentities,
    executionResources,
  };
}

function freezeAndExecute(observation, execution) {
  const receipt = freezeAIWorkflowRunResources({ ...observation, task, codeExecutions: [execution] });
  const proof = projectFrozenAIAgentTaskBinding(receipt);
  assert.equal(assertFrozenAIAgentTaskBinding(proof), proof);
  // Neither a JSON receipt nor a structural proof is accepted in this new process.
  assert.throws(() => projectFrozenAIAgentTaskBinding(JSON.parse(JSON.stringify(receipt))));
  assert.throws(() => assertFrozenAIAgentTaskBinding(JSON.parse(JSON.stringify(proof))));
  assert(Array.isArray(receipt.resourceResolutions) && receipt.resourceResolutions.length > 0,
    'A bridged execution must persist its selected reader identities');
  assert.deepEqual(execution.artifact.resourceResolution,
    receipt.resourceResolutions.find(item => item.resourceId === contextId),
    'The code artifact must bind the same reader receipt as its frozen task');
  assert.throws(() => freezeAIWorkflowRunResources({
    ...observation, task, codeExecutions: [execution],
    executionResources: { ...observation.executionResources },
  }), 'A copied execution observation must not acquire a process-local brand');
  assert.throws(() => freezeAIWorkflowRunResources({
    ...observation, task, codeExecutions: [execution], executionResources: undefined,
  }), 'A resolved code handle must not silently fall back to authored-only freeze');
  return {
    pid: process.pid,
    output: execution.execute({ format: value => `[${value}]` }, 'input'),
    semanticFingerprint: proof.semanticFingerprint,
    artifactDigest: execution.artifactDigest,
    closureDigest: execution.artifact.closure.digest,
    resourceResolutions: receipt.resourceResolutions,
    authentic: true,
    codeResourceMode: observation.code.mode,
  };
}

// A stable digest of every persisted resource file, independent of resource projection objects.
async function resourceBytesDigest(root, prefix = '') {
  const files = [];
  async function visit(relative) {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path);
      else {
        assert(entry.isFile(), 'Frozen resource package contains a non-file entry');
        files.push({ path, bytes: (await readFile(join(root, path))).toString('base64') });
      }
    }
  }
  await visit(prefix);
  return digestCanonical(files);
}

const [mode, ...args] = process.argv.slice(2);
let result;
if (mode === 'capture' || mode === 'capture-reader-v2') {
  const [resourceRoot, codeRoot, materialRoot, pinPath] = args;
  const observation = await observe(resourceRoot, mode === 'capture-reader-v2');
  const execution = await compileAgentContextPipeline({
    source: await createDirectoryResourcePackageReadPort(codeRoot),
    sourceRoot: '/', entryPath: '/pipeline.ts', environment,
  }, observation.code);
  result = freezeAndExecute(observation, execution);
  await mkdir(materialRoot);
  await cp(resourceRoot, join(materialRoot, 'resources'), { recursive: true });
  await writeFile(join(materialRoot, 'artifact.json'), JSON.stringify(execution.artifact));
  result.resourceBytesDigest = await resourceBytesDigest(join(materialRoot, 'resources'));
  // Host/run-owner pins are separate from the artifact and reconstructed proof material.
  await writeFile(pinPath, JSON.stringify({
    artifactDigest: execution.artifactDigest,
    semanticFingerprint: result.semanticFingerprint,
    resourceBytesDigest: result.resourceBytesDigest,
    resourceResolutions: result.resourceResolutions,
  }));
} else if (mode === 'restore' || mode === 'restore-tampered-host' || mode === 'restore-reader-v2') {
  const [materialRoot, pinPath] = args;
  const pins = JSON.parse(await readFile(pinPath, 'utf8'));
  const bytesDigest = await resourceBytesDigest(join(materialRoot, 'resources'));
  assert.equal(bytesDigest, pins.resourceBytesDigest, 'Frozen resource bytes differ from run-owner pin');
  const observation = await observe(join(materialRoot, 'resources'), mode === 'restore-reader-v2');
  const artifact = JSON.parse(await readFile(join(materialRoot, 'artifact.json'), 'utf8'));
  // Restore gets no source read port or live path. Public APIs mint all process-local brands.
  const execution = restoreAIAgentCodeExecution({
    environment: mode === 'restore-tampered-host'
      ? { ...environment, hostIdentity: 'cross-process-context/incompatible' }
      : environment,
  }, observation.code, artifact, pins.artifactDigest);
  result = freezeAndExecute(observation, execution);
  assert.equal(result.semanticFingerprint, pins.semanticFingerprint, 'Recovered run identity changed');
  assert.deepEqual(result.resourceResolutions, pins.resourceResolutions, 'Recovered reader identities changed');
  result.resourceBytesDigest = bytesDigest;
} else {
  throw new Error(`Unknown recovery worker mode: ${mode}`);
}
process.stdout.write(JSON.stringify(result));
