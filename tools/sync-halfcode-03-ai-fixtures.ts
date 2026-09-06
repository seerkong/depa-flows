import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  DEPA_AI_RESOURCE_KIND_CONTRACTS,
  type DepaAIResourceKind,
} from '../packages/ai-workflow-contract/src/resource-kind-contracts.js';

const workspaceRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const fixturesRoot = join(workspaceRoot, 'packages/ai-workflow-logic/test/fixtures');
const contracts = new Map(DEPA_AI_RESOURCE_KIND_CONTRACTS.map((contract) => [contract.kind, contract]));
const checkOnly = process.argv.includes('--check');
const outOfDate: string[] = [];
const legacyEnvelopePatterns = Object.freeze([
  /apiVersion="halfcode\.resources\/v1" version="1\.0\.0"/g,
  /apiVersion="depa\.flows\/v1" version="1\.0\.0"/g,
]);
const canonicalEnvelope = 'envelopeVersion="halfcode.resource-envelope/v1" specVersion=1';

const files = await xnlFiles(fixturesRoot);
for (const file of files) {
  const kind = kindDefinitionKind(file);
  if (kind) {
    const contract = contracts.get(kind);
    if (!contract) throw new Error(`No depa AI Kind contract owns fixture '${relative(workspaceRoot, file)}'.`);
    await writeIfChanged(file, contract.kindDefinitionSource);
    continue;
  }

  const source = await readFile(file, 'utf8');
  const migrated = legacyEnvelopePatterns.reduce(
    (current, pattern) => current.replace(pattern, canonicalEnvelope),
    source,
  );
  await writeIfChanged(file, migrated);
}

const remaining: string[] = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (source.includes('apiVersion="halfcode.resources/v1"') || source.includes('apiVersion="depa.flows/v1"')) {
    remaining.push(relative(workspaceRoot, file));
  }
}
if (remaining.length > 0) {
  throw new Error(`Legacy AI fixture envelopes remain:\n${remaining.join('\n')}`);
}

if (outOfDate.length > 0) {
  throw new Error(`Halfcode 0.3 AI fixtures are out of date:\n${outOfDate.join('\n')}`);
}
console.log(`${checkOnly ? 'Verified' : 'Synchronized'} ${files.length} AI fixture XNL files with ${contracts.size} Halfcode 0.3 Kind contracts.`);

async function xnlFiles(root: string): Promise<readonly string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.xnl')) output.push(path);
    }
  };
  await visit(root);
  return output.sort(compareCodeUnits);
}

function kindDefinitionKind(path: string): DepaAIResourceKind | undefined {
  const parts = path.split(sep);
  const index = parts.lastIndexOf('KindDefinitions');
  if (index < 0 || parts[index + 2] !== 'manifest.xnl') return undefined;
  const kind = parts[index + 1] as DepaAIResourceKind | undefined;
  return kind && contracts.has(kind) ? kind : undefined;
}

async function writeIfChanged(path: string, source: string): Promise<void> {
  if (await readFile(path, 'utf8') === source) return;
  if (checkOnly) {
    outOfDate.push(relative(workspaceRoot, path));
    return;
  }
  await writeFile(path, source);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
