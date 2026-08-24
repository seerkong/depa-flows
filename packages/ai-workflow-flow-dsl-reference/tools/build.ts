import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadHalfcodeResourceDslSystemSkillModule,
  loadResourceTree,
  sha256Digest,
} from 'halfcode-compiler.xnl';
import { collectCanonicalMarkdownFiles } from './source-tree.js';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(dirname(packageRoot));
const sourceRoot = join(workspaceRoot, 'docs', 'flow-dsl');
const liveDist = join(packageRoot, 'dist');
const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};

if (packageManifest.name !== 'ai-workflow-flow-dsl-reference' || packageManifest.version !== '0.1.6') {
  throw new Error('FLOW_DSL_REFERENCE_PACKAGE_IDENTITY_INVALID: expected ai-workflow-flow-dsl-reference@0.1.6');
}

const sourceFiles = await collectCanonicalMarkdownFiles(sourceRoot);
const sourceFacts = await Promise.all(sourceFiles.map(async (path) => {
  const bytes = new Uint8Array(await readFile(join(sourceRoot, ...path.split('/'))));
  return Object.freeze({ path, bytes, contentDigest: sha256Digest(bytes) });
}));
const resourceIds = new Set<string>();
for (const fact of sourceFacts) {
  const resourceId = wikiPageResourceId(fact.path);
  if (resourceIds.has(resourceId)) {
    throw new Error(`FLOW_DSL_REFERENCE_RESOURCE_ID_DUPLICATE: ${resourceId}`);
  }
  resourceIds.add(resourceId);
}

const stagingRoot = await mkdtemp(join(packageRoot, '.flow-dsl-dist-stage-'));
const backupRoot = `${liveDist}.backup-${process.pid}`;
let liveMoved = false;
try {
  await buildPublicEntry(stagingRoot);
  await buildResourceModule(join(stagingRoot, 'resource-module'));
  const loaded = await loadResourceTree({ rootDir: join(stagingRoot, 'resource-module') });
  const wikiPages = loaded.registry.byKind.get('WikiPage') ?? [];
  if (wikiPages.length !== sourceFacts.length) {
    throw new Error(`FLOW_DSL_REFERENCE_RESOURCE_COUNT_MISMATCH: expected ${sourceFacts.length}, received ${wikiPages.length}`);
  }

  await rm(backupRoot, { recursive: true, force: true });
  try {
    await rename(liveDist, backupRoot);
    liveMoved = true;
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
  try {
    await rename(stagingRoot, liveDist);
  } catch (error) {
    if (liveMoved) await rename(backupRoot, liveDist);
    throw error;
  }
  if (liveMoved) await rm(backupRoot, { recursive: true, force: true });
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

async function buildPublicEntry(outputRoot: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(packageRoot, 'src', 'index.ts')],
    outdir: outputRoot,
    target: 'node',
    format: 'esm',
    external: ['halfcode-compiler.xnl'],
    naming: '[name].js',
  });
  if (!result.success) {
    throw new Error(`FLOW_DSL_REFERENCE_BUILD_FAILED: ${result.logs.map((item) => item.message).join('; ')}`);
  }

  const typecheck = Bun.spawn([
    'bunx',
    'tsc',
    '--project',
    join(packageRoot, 'tsconfig.build.json'),
    '--outDir',
    outputRoot,
  ], { cwd: workspaceRoot, stdout: 'inherit', stderr: 'inherit' });
  const exitCode = await typecheck.exited;
  if (exitCode !== 0) throw new Error(`FLOW_DSL_REFERENCE_DECLARATION_BUILD_FAILED: tsc exited ${exitCode}`);
}

async function buildResourceModule(moduleRoot: string): Promise<void> {
  await mkdir(join(moduleRoot, 'KindDefinitions', 'WikiPage'), { recursive: true });
  await mkdir(join(moduleRoot, 'WikiPages'), { recursive: true });
  await mkdir(join(moduleRoot, 'content'), { recursive: true });

  const halfcodeModule = loadHalfcodeResourceDslSystemSkillModule();
  const canonicalKindDefinition = join(
    halfcodeModule.resourceRootDir,
    'KindDefinitions',
    'WikiPage',
    'manifest.xnl',
  );
  const kindDefinitionBytes = new Uint8Array(await readFile(canonicalKindDefinition));
  await writeFile(
    join(moduleRoot, 'KindDefinitions', 'WikiPage', 'manifest.xnl'),
    kindDefinitionBytes,
  );

  await writeFile(join(moduleRoot, 'manifest.xnl'), resourcePackageManifest());
  for (const fact of sourceFacts) {
    const sourcePath = join(sourceRoot, ...fact.path.split('/'));
    const targetPath = join(moduleRoot, 'content', ...fact.path.split('/'));
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { dereference: false, errorOnExist: true });
    const copiedBytes = new Uint8Array(await readFile(targetPath));
    if (sha256Digest(copiedBytes) !== fact.contentDigest) {
      throw new Error(`FLOW_DSL_REFERENCE_SOURCE_DRIFT: ${fact.path}`);
    }

    const wikiRoot = join(moduleRoot, 'WikiPages', wikiPageDirectory(fact.path));
    await mkdir(wikiRoot, { recursive: true });
    await writeFile(join(wikiRoot, 'manifest.xnl'), wikiPageManifest(fact.path));
  }

  const provenance = {
    schemaVersion: 'depa.flow-dsl-reference/v1',
    moduleId: 'DepaFlowsFlowDslReference',
    packageName: packageManifest.name,
    packageVersion: packageManifest.version,
    resourcePackageVersion: '1.0.1',
    source: 'depa-flows/docs/flow-dsl',
    sourceTreeDigest: sha256Digest(JSON.stringify(sourceFacts.map(({ path, contentDigest }) => ({ path, contentDigest })))),
    files: sourceFacts.map(({ path, contentDigest }) => ({ path, contentDigest })),
  };
  await writeFile(
    join(moduleRoot, 'content', '.depa-flow-dsl-provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
}

function resourcePackageManifest(): string {
  return `<ResourcePackage #Depa.Flows.FlowDsl.Reference.Package apiVersion="halfcode.resources/v1" version="1.0.1" {
  lifecycle = "Stable"
  description = "Canonical depa Flow DSL documentation reference resources for authoring Skills."
} (
  <Catalogs [
    <Catalog #KindDefinitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>
    <Catalog #WikiPages { kind = "WikiPage" shape = "directory" root = "vfs://./WikiPages/" entry = "manifest.xnl" }>
  ]>
)>
`;
}

function wikiPageManifest(path: string): string {
  return `<WikiPage #${wikiPageResourceId(path)} apiVersion="halfcode.resources/v1" version="1.0.1" {
  lifecycle = "Stable"
  description = "Canonical depa Flow DSL reference page: ${path}."
} (
  <Instruction { href = "vfs://@/content/${path}" format = "markdown" }>
)>
`;
}

function wikiPageResourceId(path: string): string {
  const segments = path.replace(/\.md$/i, '').split('/').flatMap((segment) => segment.split(/[^A-Za-z0-9]+/u));
  const suffix = segments.filter(Boolean).map(toPascalSegment).join('.');
  return `Depa.Flows.FlowDsl.Reference.Wiki.${suffix}`;
}

function wikiPageDirectory(path: string): string {
  return path.replace(/\.md$/i, '').split('/').map((segment) => segment.replace(/[^A-Za-z0-9.-]/gu, '-')).join('__');
}

function toPascalSegment(value: string): string {
  const normalized = `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
  return /^\d/u.test(normalized) ? `N${normalized}` : normalized;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
