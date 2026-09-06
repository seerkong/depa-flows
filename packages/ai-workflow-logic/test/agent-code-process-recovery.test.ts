import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { depaAIResourceKindContract } from 'ai-workflow-contract';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const sourceBindings = join(repositoryRoot, '.tmp/mission-source-bindings.json');
const workerScript = join(import.meta.dir, 'fixtures/agent-code-process-recovery.mjs');
const resourceFixture = join(import.meta.dir, 'fixtures/HalfcodeAIAgentResourcePackage');
const nativeContext = `<AgentContextPipeline #depa.flows.test.ContextPipeline.Standard envelopeVersion="halfcode.resource-envelope/v1" specVersion=2 { lifecycle="Active" } (
  <CodeBinding { packageName="process-test-code" module="./pipeline.ts" exportName="compose" }>
  <Config { value={ prefix="fact:" } }>
  <Assets [<Asset { path="word.txt" format="text" }>]>
  <DependencyRefs [<DependencyRef #prompt { kind="Prompt" ref="resource://depa.flows.test.Prompt.System" }>]>
)>`;

interface ProcessEvidence {
  readonly pid: number;
  readonly output: string;
  readonly semanticFingerprint: string;
  readonly artifactDigest: string;
  readonly closureDigest: string;
  readonly resourceResolutions: readonly Readonly<Record<string, unknown>>[];
  readonly resourceBytesDigest: string;
  readonly authentic: boolean;
  readonly codeResourceMode: string;
}

test('fresh OS processes pin reader and code identities and restore V1 after deleting all live sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-code-process-recovery-'));
  try {
    const liveResources = join(root, 'live-resources');
    const liveCode = join(root, 'live-code');
    const v1Material = join(root, 'frozen-v1');
    const v2Material = join(root, 'frozen-v2');
    const pinRoot = join(root, 'run-owner-pins');
    const v1Pins = join(pinRoot, 'v1.json');
    const v2Pins = join(pinRoot, 'v2.json');
    await cp(resourceFixture, liveResources, { recursive: true });
    await mkdir(liveCode);
    await mkdir(pinRoot);
    await writeFile(join(liveResources, 'ContextPipelines/Standard.xnl'), nativeContext);
    await writeFile(join(liveResources, 'KindDefinitions/AgentContextPipeline/manifest.xnl'),
      depaAIResourceKindContract('AgentContextPipeline', 2).kindDefinitionSource);
    await writeFile(join(liveCode, 'pipeline.ts'), [
      'import { value } from "./helper";',
      'import word from "./word.txt";',
      'export function compose(runtime, input, config) { return config.prefix + runtime.format(value + word + input); }',
    ].join('\n'));
    await writeFile(join(liveCode, 'helper.ts'), 'export const value = "V1:";');
    await writeFile(join(liveCode, 'word.txt'), 'asset:');

    // A persists only bytes, closed artifacts and separate run-owner pins, then exits.
    const v1 = await runSuccessfulProcess('capture', liveResources, liveCode, v1Material, v1Pins);
    expect(v1).toMatchObject({ output: 'fact:[V1:asset:input]', authentic: true, codeResourceMode: 'native' });
    const persistedPins = JSON.parse(await readFile(v1Pins, 'utf8'));
    expect(persistedPins.artifactDigest).toBe(v1.artifactDigest);
    expect(persistedPins.semanticFingerprint).toBe(v1.semanticFingerprint);
    expect(persistedPins.resourceBytesDigest).toBe(v1.resourceBytesDigest);
    expect(persistedPins.resourceResolutions).toEqual(v1.resourceResolutions);
    expect(v1.resourceResolutions.length).toBeGreaterThan(0);
    await expect(access(join(v1Material, 'resources/pipeline.ts'))).rejects.toThrow();

    // Same authored documents and code, different actual reader implementation identity.
    const readerV2 = await runSuccessfulProcess('capture-reader-v2', liveResources, liveCode,
      join(root, 'frozen-reader-v2'), join(pinRoot, 'reader-v2.json'));
    expect(readerV2.output).toBe(v1.output);
    expect(readerV2.resourceBytesDigest).toBe(v1.resourceBytesDigest);
    expect(readerV2.closureDigest).toBe(v1.closureDigest);
    expect(readerV2.artifactDigest).not.toBe(v1.artifactDigest);
    expect(readerV2.resourceResolutions).not.toEqual(v1.resourceResolutions);
    expect(readerV2.semanticFingerprint).not.toBe(v1.semanticFingerprint);

    // B is a fresh process and must observe changed helper code with identical resource bytes.
    await writeFile(join(liveCode, 'helper.ts'), 'export const value = "V2:";');
    const v2 = await runSuccessfulProcess('capture', liveResources, liveCode, v2Material, v2Pins);
    expect(v2).toMatchObject({ output: 'fact:[V2:asset:input]', authentic: true, codeResourceMode: 'native' });
    expect(v2.resourceBytesDigest).toBe(v1.resourceBytesDigest);
    expect(v2.artifactDigest).not.toBe(v1.artifactDigest);
    expect(v2.semanticFingerprint).not.toBe(v1.semanticFingerprint);
    expect(v2.resourceResolutions).toEqual(v1.resourceResolutions);

    // C receives no live path. Both resource and code sources are physically gone.
    await rm(liveCode, { recursive: true });
    await rm(liveResources, { recursive: true });
    await expect(access(liveCode)).rejects.toThrow();
    await expect(access(liveResources)).rejects.toThrow();
    const recovered = await runSuccessfulProcess('restore', v1Material, v1Pins);
    expect(recovered).toMatchObject({
      output: v1.output, authentic: true, codeResourceMode: 'native',
      semanticFingerprint: v1.semanticFingerprint,
      artifactDigest: v1.artifactDigest,
      resourceBytesDigest: v1.resourceBytesDigest,
      closureDigest: v1.closureDigest,
      resourceResolutions: v1.resourceResolutions,
    });
    expect(new Set([process.pid, v1.pid, readerV2.pid, v2.pid, recovered.pid]).size).toBe(5);

    const readerDrift = await runProcess('restore-reader-v2', v1Material, v1Pins);
    expect(readerDrift.exitCode).not.toBe(0);
    expect(readerDrift.stderr).toMatch(/reader|resolution|exact resource recipe/i);
    expect(readerDrift.stdout).toBe('');

    // D rejects a different host identity using the same untampered V1 artifact and pins.
    const incompatible = await runProcess('restore-tampered-host', v1Material, v1Pins);
    expect(incompatible.exitCode).not.toBe(0);
    expect(incompatible.stderr).toContain('environment');
    expect(incompatible.stdout).toBe('');

    // A closed artifact is not its own authority: the separate pinned digest rejects edits.
    const artifactPath = join(v1Material, 'artifact.json');
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    artifact.config.prefix = 'tampered:';
    await writeFile(artifactPath, JSON.stringify(artifact));
    const corrupted = await runProcess('restore', v1Material, v1Pins);
    expect(corrupted.exitCode).not.toBe(0);
    expect(corrupted.stderr).toContain('trusted expected digest');
    expect(corrupted.stdout).toBe('');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

async function runSuccessfulProcess(...args: string[]): Promise<ProcessEvidence> {
  const result = await runProcess(...args);
  if (result.exitCode !== 0) throw new Error(`Child process failed (${args[0]}):\n${result.stderr}`);
  return JSON.parse(result.stdout) as ProcessEvidence;
}

async function runProcess(...args: string[]) {
  const sourceOptions = existsSync(sourceBindings) ? ['--tsconfig-override', sourceBindings] : [];
  const child = Bun.spawn([process.execPath, ...sourceOptions, workerScript, ...args], {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
