/** Verify packed/registry code against installed public modules, without workspace aliases. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dir, '..');
const consumer = await mkdtemp(join(tmpdir(), 'workflow-code-package-'));
const fromRegistry = process.argv.includes('--registry');
const halfcodeTarball = process.argv.find((arg) => arg.endsWith('.tgz'));
const names = ['halfcode-compiler.xnl', 'ai-workflow-contract', 'ai-workflow-logic'] as const;
const versions = { 'halfcode-compiler.xnl': '0.3.1', 'ai-workflow-contract': '0.2.1', 'ai-workflow-logic': '0.2.1' };
const registry = 'https://registry.npmjs.com';
const userconfig = join(homedir(), '.npmrc_official');

async function run(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(' ')} failed (${exitCode})\n${stdout}\n${stderr}`);
  if (stderr) process.stderr.write(stderr);
  return stdout;
}

try {
  const dependencies: Record<string, string> = {
    'ai-data-workflow-logic': '0.2.0', 'ai-ctrl-workflow-logic': '0.2.0',
    'task-manager-file-support': '0.1.5',
  };
  for (const name of names) {
    if (fromRegistry) dependencies[name] = versions[name];
    else if (name === 'halfcode-compiler.xnl') {
      if (!halfcodeTarball) throw new Error('Pass a verified Halfcode .tgz or --registry');
      dependencies[name] = resolve(halfcodeTarball);
    } else {
      const packed = JSON.parse(await run(['npm', 'pack', '--json', '--pack-destination', consumer,
        '--userconfig', userconfig, '--registry', registry], join(repository, 'packages', name)))[0];
      if (packed.files.some((file: { path: string }) => !file.path.startsWith('src/') && !['README.md', 'package.json'].includes(file.path))) {
        throw new Error(`Unexpected publication file in ${name}`);
      }
      dependencies[name] = join(consumer, packed.filename);
      console.log(JSON.stringify({ name, version: versions[name], integrity: packed.integrity }));
    }
  }
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    private: true, type: 'module', dependencies,
    // Same runtime owner must validate objects created by Data/Ctrl and direct callers.
    overrides: Object.fromEntries(names.map((name) => [name, `$${name}`])),
  }, null, 2));
  await run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--userconfig', userconfig, '--registry', registry], consumer);

  const tests: Record<string, string[]> = {
    'ai-workflow-logic': ['agent-code-execution.test.ts', 'agent-code-process-recovery.test.ts',
      'agent-execution-resources.test.ts', 'agent-definition-selection.test.ts', 'run-freeze.test.ts',
      'holon-task-target.test.ts', 'resource-kind-contracts.test.ts'],
    'ai-data-workflow-logic': ['checkpoint-store.test.ts'],
    'ai-ctrl-workflow-logic': ['checkpoint-store.test.ts'],
  };
  const testPaths: string[] = [];
  for (const [name, files] of Object.entries(tests)) {
    const source = join(repository, 'packages', name, 'test');
    const target = join(consumer, 'node_modules', name, 'test');
    await mkdir(target, { recursive: true });
    if (name === 'ai-workflow-logic') await cp(join(source, 'fixtures'), join(target, 'fixtures'), { recursive: true });
    for (const file of files) {
      await cp(join(source, file), join(target, file));
      testPaths.push(join(target, file));
    }
  }
  for (const name of names) {
    const installed = JSON.parse(await readFile(join(consumer, 'node_modules', name, 'package.json'), 'utf8'));
    if (installed.version !== versions[name]) throw new Error(`Wrong installed version for ${name}`);
  }
  // Reject duplicate Halfcode/workflow owners in the physical dependency graph.
  const tree = JSON.parse(await run(['npm', 'ls', '--all', '--json'], consumer));
  function checkTree(node: { dependencies?: Record<string, { version?: string }> }): void {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (name in versions && child.version !== versions[name as keyof typeof versions]) {
        throw new Error(`Duplicate authority ${name}@${child.version}`);
      }
      checkTree(child);
    }
  }
  checkTree(tree);
  // The repository's source-graph ratchet runs separately; this checks installed public identities.
  await run([process.execPath, '-e', `
    import assert from 'node:assert/strict';
    const root = await import('ai-workflow-logic');
    const browser = await import('ai-workflow-logic/browser');
    assert.equal(typeof root.admitAIAgentDefinitionSelection, 'function');
    for (const key of ['projectAIWorkflowAgentResources', 'projectAIWorkflowAppBundles',
      'normalizeFlowClosedObject', 'InMemoryFlowRunCheckpointStore']) assert.equal(browser[key], root[key]);
    assert.equal('admitAIAgentDefinitionSelection' in browser, false);
    assert.equal('createAIAgentDefinitionSelectionOwner' in browser, false);
  `], consumer);
  console.log(await run([process.execPath, 'test', ...testPaths], consumer));
  console.log(JSON.stringify({ mode: fromRegistry ? 'registry' : 'packed', versions, result: 'PASS' }));
} finally {
  await rm(consumer, { recursive: true, force: true });
}
