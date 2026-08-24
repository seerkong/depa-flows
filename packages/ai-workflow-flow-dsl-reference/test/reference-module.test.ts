import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  loadHalfcodeResourceDslSystemSkillModule,
  loadResourceTree,
  planSkillCapsuleDistribution,
  resolveApplicationAssembly,
  sha256Digest,
} from 'halfcode-compiler.xnl';
import {
  AI_WORKFLOW_FLOW_DSL_REFERENCE_MODULE,
  loadAIWorkflowFlowDslReferenceModule,
} from '../dist/index.js';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(dirname(packageRoot));
const canonicalRoot = join(workspaceRoot, 'docs', 'flow-dsl');

describe('AI Workflow Flow DSL reference module', () => {
  test('exposes the fixed module identity without host policy', async () => {
    expect(AI_WORKFLOW_FLOW_DSL_REFERENCE_MODULE).toEqual({
      id: 'DepaFlowsFlowDslReference',
      packageName: 'ai-workflow-flow-dsl-reference',
      family: 'depa-flow-dsl',
      scope: 'shared',
    });
    expect(Object.isFrozen(AI_WORKFLOW_FLOW_DSL_REFERENCE_MODULE)).toBe(true);

    const first = loadAIWorkflowFlowDslReferenceModule();
    const second = loadAIWorkflowFlowDslReferenceModule();
    expect(first).not.toBe(second);
    expect(first).toEqual({
      ...AI_WORKFLOW_FLOW_DSL_REFERENCE_MODULE,
      resourceRootDir: `${join(packageRoot, 'dist', 'resource-module')}${sep}`,
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(await realpath(first.resourceRootDir)).toStartWith(`${await realpath(packageRoot)}${sep}`);
    expect((await stat(join(first.resourceRootDir, 'manifest.xnl'))).isFile()).toBe(true);
  });

  test('keeps generated canonical Markdown bytes and provenance aligned', async () => {
    const module = loadAIWorkflowFlowDslReferenceModule();
    const generatedRoot = join(module.resourceRootDir, 'content');
    const canonicalFiles = await listMarkdownFiles(canonicalRoot);
    const generatedFiles = await listMarkdownFiles(generatedRoot);

    expect(generatedFiles).toEqual(canonicalFiles);
    for (const path of canonicalFiles) {
      expect(await readFile(join(generatedRoot, path))).toEqual(await readFile(join(canonicalRoot, path)));
    }

    const provenance = JSON.parse(await readFile(
      join(generatedRoot, '.depa-flow-dsl-provenance.json'),
      'utf8',
    )) as {
      schemaVersion: string;
      moduleId: string;
      packageName: string;
      packageVersion: string;
      source: string;
      sourceTreeDigest: string;
      files: Array<{ path: string; contentDigest: string }>;
    };
    expect(provenance.schemaVersion).toBe('depa.flow-dsl-reference/v1');
    expect(provenance.moduleId).toBe('DepaFlowsFlowDslReference');
    expect(provenance.packageName).toBe('ai-workflow-flow-dsl-reference');
    expect(provenance.packageVersion).toBe('0.1.6');
    expect(provenance.source).toBe('depa-flows/docs/flow-dsl');
    expect(provenance.files.map((file) => file.path)).toEqual(canonicalFiles);
    expect(provenance.files.every((file) => /^sha256:[a-f0-9]{64}$/.test(file.contentDigest))).toBe(true);
    for (const file of provenance.files) {
      expect(file.contentDigest).toBe(sha256Digest(new Uint8Array(await readFile(join(canonicalRoot, file.path)))));
    }
    expect(provenance.sourceTreeDigest).toBe(sha256Digest(JSON.stringify(provenance.files)));

    const halfcodeModule = loadHalfcodeResourceDslSystemSkillModule();
    expect(await readFile(join(module.resourceRootDir, 'KindDefinitions', 'WikiPage', 'manifest.xnl'))).toEqual(
      await readFile(join(halfcodeModule.resourceRootDir, 'KindDefinitions', 'WikiPage', 'manifest.xnl')),
    );
  });

  test('loads as a normalized Halfcode module without defining another SkillCapsule', async () => {
    const module = loadAIWorkflowFlowDslReferenceModule();
    const tree = await loadResourceTree({ rootDir: module.resourceRootDir });
    const canonicalFiles = await listMarkdownFiles(canonicalRoot);

    expect(tree.manifest.resourceId).toBe('Depa.Flows.FlowDsl.Reference.Package');
    expect(tree.registry.byKind.get('WikiPage')?.length).toBe(canonicalFiles.length);
    expect(tree.registry.byKind.get('SkillCapsule') ?? []).toEqual([]);

    const assembly = await resolveApplicationAssembly({ modules: [module], portBindings: [] });
    expect(assembly.modules.map((item) => item.id)).toEqual(['DepaFlowsFlowDslReference']);
    expect(assembly.skillCapsules).toEqual([]);
  });

  test('embeds the reference tree in one downstream authoring Skill', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'depa-flow-dsl-reference-'));
    try {
      const authoringModule = await createAuthoringFixtureModule(temporaryRoot);
      const referenceModule = loadAIWorkflowFlowDslReferenceModule();
      const assembly = await resolveApplicationAssembly({
        modules: [referenceModule, authoringModule],
        portBindings: [],
      });
      const plan = await planSkillCapsuleDistribution({
        assembly,
        rootSkillFqns: ['Eidolon.Test.Skill.Authoring'],
      });

      expect(plan.topology).toEqual(['Eidolon.Test.Skill.Authoring']);
      expect(plan.capsules).toHaveLength(1);
      expect(plan.files.some((file) => file.targetRelativePath.includes('sys-eidolon-anchor-authoring-test/references/flow-dsl/README.md'))).toBe(true);
      expect(plan.files.some((file) => file.targetRelativePath.endsWith('references/flow-dsl/.depa-flow-dsl-provenance.json'))).toBe(true);

      for (const path of await listMarkdownFiles(canonicalRoot)) {
        const target = `sys-eidolon-anchor-authoring-test/references/flow-dsl/${path}`;
        const planned = plan.files.find((file) => file.targetRelativePath === target);
        expect(planned, target).toBeDefined();
        expect(Buffer.from(planned!.contentBase64, 'base64')).toEqual(await readFile(join(canonicalRoot, path)));
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('publishes the terminal-smallest package metadata without registry selection', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
      dependencies: Record<string, string>;
      publishConfig: Record<string, string>;
    };
    expect(manifest.name).toBe('ai-workflow-flow-dsl-reference');
    expect(manifest.version).toBe('0.1.6');
    expect(manifest.dependencies).toEqual({ 'halfcode-compiler.xnl': '0.2.3' });
    expect(manifest.publishConfig).toEqual({ access: 'public' });
  });
});

async function createAuthoringFixtureModule(root: string) {
  const kindDefinitionRoot = join(root, 'KindDefinitions', 'SkillCapsule');
  const skillRoot = join(root, 'SkillCapsules', 'Authoring');
  await mkdir(kindDefinitionRoot, { recursive: true });
  await mkdir(skillRoot, { recursive: true });

  const halfcodeModule = loadHalfcodeResourceDslSystemSkillModule();
  await cp(
    join(halfcodeModule.resourceRootDir, 'KindDefinitions', 'SkillCapsule', 'manifest.xnl'),
    join(kindDefinitionRoot, 'manifest.xnl'),
  );
  await writeFile(join(root, 'manifest.xnl'), `<ResourcePackage #Eidolon.Test.Authoring.Package apiVersion="halfcode.resources/v1" version="1.0.0" {
  lifecycle = "Testing"
  description = "Fixture authoring Skill that embeds depa Flow DSL references."
} (
  <Catalogs [
    <Catalog #KindDefinitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>
    <Catalog #SkillCapsules { kind = "SkillCapsule" shape = "directory" root = "vfs://./SkillCapsules/" entry = "manifest.xnl" }>
  ]>
)>
`);
  await writeFile(join(skillRoot, 'manifest.xnl'), `<SkillCapsule #Eidolon.Test.Skill.Authoring apiVersion="halfcode.resources/v1" version="1.0.0" {
  name = "sys-eidolon-anchor-authoring-test"
  lifecycle = "Testing"
  description = "Fixture authoring Skill."
} (
  <SkillMetadata { href = "vfs://./SKILL.metadata.yaml" format = "yaml" }>
  <Template { href = "vfs://./SKILL.template.ejs" format = "ejs" }>
  <ResourceMappings { href = "vfs://./resource-mappings.xnl" format = "xnl" }>
  <Includes [
    <Include { kind = "WikiPage" ref = "resource://Depa.Flows.FlowDsl.Reference.Wiki.Readme" }>
  ]>
)>
`);
  await writeFile(join(skillRoot, 'SKILL.metadata.yaml'), 'title: Eidolon authoring fixture\ndescription: Test-only authoring reference composition.\n');
  await writeFile(join(skillRoot, 'SKILL.template.ejs'), '---\nname: <%= metadata.name %>\ndescription: Test fixture.\n---\n\nRead references/flow-dsl/README.md first.\n');
  await writeFile(join(skillRoot, 'resource-mappings.xnl'), `<ResourceMappings #Eidolon.Test.ResourceMappings.Authoring apiVersion="halfcode.resources/v1" version="1.0.0" (
  <SourceRoots [
    <SourceRoot #FlowDsl { sourceRoot = "vfs://module/DepaFlowsFlowDslReference/" } [
      <CopyDirectory { from = "content" to = "references/flow-dsl" }>
    ]>
  ]>
)>
`);
  return Object.freeze({
    id: 'EidolonAuthoringFixture',
    packageName: 'eidolon-authoring-fixture',
    family: 'eidolon-authoring',
    scope: 'domain' as const,
    resourceRootDir: root,
  });
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  await visit(root, '');
  return paths.sort(compareCodeUnits);

  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(directory, entry.name), path);
      else if (entry.isFile() && entry.name.endsWith('.md')) paths.push(path);
    }
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
