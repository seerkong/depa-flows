import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEPA_AI_RESOURCE_ENVELOPE_VERSION,
  DEPA_AI_RESOURCE_KIND_CONTRACTS,
  DEPA_AI_RESOURCE_KIND_OWNERS,
  DEPA_AI_RESOURCE_KIND_READER_REGISTRATIONS,
  DEPA_AI_RESOURCE_KIND_SPEC_REVISIONS,
  DEPA_AI_RESOURCE_KIND_SPEC_RESOLUTIONS,
  DEPA_AI_RESOURCE_KINDS,
  depaAIResourceKindContract,
} from 'ai-workflow-contract';
import {
  loadResourceTree,
  type JsonSchema,
  type JsonSchemaValidator,
  type KindSpecRevision,
  type PortableSpec,
} from 'halfcode-compiler.xnl/resource-core';
import {
  CORE_KIND_READER_REGISTRATIONS,
  CORE_KIND_SPEC_REVISIONS,
  CORE_KIND_SUBJECT_OWNERS,
  KindContractRegistry,
  KindReaderRegistry,
  SpecResolutionRegistry,
  createReaderProfile,
  resolveResourceTree,
} from 'halfcode-compiler.xnl/kind-definition';

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe('depa AI Halfcode 0.3 resource Kind contracts', () => {
  test('exports one owner per public Kind and readers for every admitted revision', () => {
    expect(DEPA_AI_RESOURCE_KINDS).toHaveLength(14);
    expect(new Set(DEPA_AI_RESOURCE_KINDS).size).toBe(14);
    expect(DEPA_AI_RESOURCE_KIND_OWNERS).toHaveLength(14);
    expect(DEPA_AI_RESOURCE_KIND_SPEC_REVISIONS).toHaveLength(16);
    expect(DEPA_AI_RESOURCE_KIND_READER_REGISTRATIONS).toHaveLength(16);

    for (const contract of DEPA_AI_RESOURCE_KIND_CONTRACTS) {
      expect(contract.owner.kind).toBe(contract.kind);
      expect(contract.owner.subjectFqn).toBe(contract.subjectFqn);
      expect(contract.revision.subjectFqn).toBe(contract.subjectFqn);
      expect(contract.revision.specVersion).toBe(contract.reader.readerSpecVersion);
      expect(contract.reader.contractFingerprint).toBe(contract.revision.contractFingerprint);
      expect(contract.reader.compatibilityPolicy).toBe(contract.revision.specVersion === 1 ? 'exact' : 'backward-transitive');
      expect(contract.kindDefinitionSource).toContain(
        `envelopeVersion="${DEPA_AI_RESOURCE_ENVELOPE_VERSION}" specVersion=1`,
      );
      expect(contract.kindDefinitionSource).toContain(`resourceKind = "${contract.kind}"`);
      expect(contract.kindDefinitionSource).toContain(`subjectFqn = "${contract.subjectFqn}"`);
      expect(contract.kindDefinitionSource).toContain(
        `contractFingerprint = "${contract.revision.contractFingerprint}"`,
      );
    }
  });

  test('resolves the complete canonical Kind closure through exact reader receipts', async () => {
    const root = await createResourcePackage();
    const authored = await loadResourceTree({ rootDir: root });
    const resolved = resolveResourceTree({ tree: authored, ...registrations(), validator: schemaValidator });

    for (const contract of DEPA_AI_RESOURCE_KIND_CONTRACTS.filter((entry) => entry.revision.specVersion === 1)) {
      const record = resolved.registry.byKind.get(contract.kind)?.[0];
      expect(record?.stage).toBe('resolved');
      expect(record?.subjectFqn).toBe(contract.subjectFqn);
      expect(record?.readerId).toBe(contract.reader.readerId);
      expect(record?.resolution.writer.contractFingerprint).toBe(contract.revision.contractFingerprint);
      expect(record?.resolution.reader.contractFingerprint).toBe(contract.revision.contractFingerprint);
      expect(record?.readerValue).toBe(record?.resolvedSpec);
    }
  });

  test('rejects a forged KindDefinition contract fingerprint before projection', async () => {
    const first = DEPA_AI_RESOURCE_KIND_CONTRACTS[0]!;
    const forged = first.kindDefinitionSource.replace(
      first.revision.contractFingerprint,
      `sha256:${first.revision.contractFingerprint.slice('sha256:'.length).replace(/^./, (value) => value === '0' ? '1' : '0')}`,
    );
    const root = await createResourcePackage({ kindDefinitionOverride: { kind: first.kind, source: forged } });
    const authored = await loadResourceTree({ rootDir: root });
    expect(() => resolveResourceTree({ tree: authored, ...registrations(), validator: schemaValidator }))
      .toThrow('differs from admitted contract content');
  });

  test('rejects the legacy Halfcode package envelope', async () => {
    const root = await createResourcePackage({ legacyManifest: true });
    await expect(loadResourceTree({ rootDir: root })).rejects.toThrow();
  });

  test('keeps legacy fingerprints and defaults while admitting exact v2 readers', () => {
    for (const [kind, fingerprint, readerFingerprint] of [
      ['AgentMessageSource', 'sha256:45dc7fc29b9e99a4bd9f0851ba4684ef59d2b33afd5a5456eb830b17f2064dc7', 'sha256:52f8c83c9b834edf931eae61249feedd269d18526b661b2fdc9590cf95320e87'],
      ['AgentContextPipeline', 'sha256:4dbd57579a67676cc5e4d566cd4f29875b75ea4fc5769226458653d523ea9c2d', 'sha256:15b8665000d4f4126d15bb4ae3ab9fa9a198e561435f0b416ca4454bc2f97457'],
    ] as const) {
      const legacy = depaAIResourceKindContract(kind);
      const native = depaAIResourceKindContract(kind, 2);
      expect(legacy).toBe(depaAIResourceKindContract(kind, 1));
      expect(legacy.revision.contractFingerprint).toBe(fingerprint);
      expect(legacy.reader.readerImplementationFingerprint).toBe(readerFingerprint);
      expect(native.revision.specVersion).toBe(2);
      expect(native.owner).toBe(legacy.owner);
      expect(native.revision.contractFingerprint).not.toBe(fingerprint);
      expect(native.revision.semanticContract).not.toEqual(legacy.revision.semanticContract);
      expect(native.reader.readerId).toBe(`ai-workflow-contract.${kind}.reader.v2`);
      expect(native.kindDefinitionSource).toContain('schemaRef = "vfs://./spec-v2.schema.json"');
    }
    expect(() => depaAIResourceKindContract('Prompt', 2)).toThrow();
    expect(() => depaAIResourceKindContract('AgentMessageSource', 3)).toThrow();
  });

  test('resolves v2 code bindings with metadata, JSON config, assets, and typed refs', async () => {
    const root = await createResourcePackage({ codeVersion: 2 });
    const resolved = resolveResourceTree({
      tree: await loadResourceTree({ rootDir: root }), ...registrations(2), validator: schemaValidator,
    });
    for (const kind of ['AgentMessageSource', 'AgentContextPipeline'] as const) {
      const resource = resolved.registry.byKind.get(kind)![0]!;
      expect(resource.readerId).toBe(depaAIResourceKindContract(kind, 2).reader.readerId);
      expect(resource.readerValue).toBe(resource.resolvedSpec);
      expect(resource.node.subdomains.CodeBinding?.properties).toEqual({ packageName: 'test.recipes', module: './source.ts', exportName: 'compile' });
      expect(resource.node.subdomains.DependencyRefs?.body).toHaveLength(1);
    }
  });

  test('rejects malformed v2 code configuration before projection', async () => {
    for (const [from, to] of [
      ['exportName = "compile"', 'exportName = ""'],
      ['exportName = "compile"', 'exportName = "compile" moduleSpecifier = "unsafe"'],
      ['<Config { value = { enabled = true nested = [1 "two" null] } }>', '<Config { value = "not-an-object" }>'],
      ['format = "text"', 'format = "binary"'],
      ['ref = "resource://depa.flows.test.Prompt"', 'ref = "latest"'],
      ['kind = "Prompt" ref', 'kind = "Prompt" unexpected = true ref'],
      ['<CodeBinding', '<Unexpected'],
      ['<CodeBinding {', '<Content ?>legacy</?> <CodeBinding {'],
    ]) {
      const root = await createResourcePackage({ codeVersion: 2, codeMutation: (source) => source.replace(from!, to!) });
      const tree = await loadResourceTree({ rootDir: root });
      expect(() => resolveResourceTree({ tree, ...registrations(2), validator: schemaValidator })).toThrow();
    }
  });

  test('owner resolution reads v1 Content and v2 code in one declared Kind revision set', async () => {
    const root = await createResourcePackage({ codeVersion: 2 });
    await writeFile(join(root, 'Resources/AgentMessageSource/Legacy.xnl'),
      minimalResourceSource('AgentMessageSource').replace('#depa.flows.test.AgentMessageSource', '#depa.flows.test.Legacy'));
    const resolved = resolveResourceTree({ tree: await loadResourceTree({ rootDir: root }), ...registrations(2), validator: schemaValidator });
    const source = resolved.registry.byKind.get('AgentMessageSource')!.find((record) => record.resourceId === 'depa.flows.test.Legacy')!;
    expect(source.resolution.writer.specVersion).toBe(1);
    expect(source.resolution.reader.specVersion).toBe(2);
    expect(source.node.subdomains.Content?.text).toContain('export function compile');
    expect(source.resolution.path).toHaveLength(1);
    expect(DEPA_AI_RESOURCE_KIND_SPEC_RESOLUTIONS).toHaveLength(2);
  });
});

function registrations(codeVersion = 1) {
  const contracts = new KindContractRegistry();
  for (const owner of [...CORE_KIND_SUBJECT_OWNERS, ...DEPA_AI_RESOURCE_KIND_OWNERS]) {
    contracts.registerOwner(owner);
  }
  for (const revision of [...CORE_KIND_SPEC_REVISIONS, ...DEPA_AI_RESOURCE_KIND_SPEC_REVISIONS]) {
    if (codeVersion === 1 && revision.specVersion !== 1) continue;
    contracts.registerRevision(revision);
  }

  const readers = new KindReaderRegistry();
  const registrations = [
    ...CORE_KIND_READER_REGISTRATIONS,
    ...DEPA_AI_RESOURCE_KIND_READER_REGISTRATIONS,
  ];
  for (const reader of registrations) readers.register(reader);
  const readerProfile = createReaderProfile(
    'depa.flows.ai-resources.v1',
    registrations.filter((reader) => !['Depa.Flows.KindDefinition.AgentMessageSource', 'Depa.Flows.KindDefinition.AgentContextPipeline'].includes(reader.subjectFqn) || reader.readerSpecVersion === codeVersion).map((reader) => ({
      readerId: reader.readerId,
      subjectFqn: reader.subjectFqn,
      readerSpecVersion: reader.readerSpecVersion,
      contractFingerprint: reader.contractFingerprint,
      readerImplementationFingerprint: reader.readerImplementationFingerprint,
    })),
  );
  const resolutions = new SpecResolutionRegistry(contracts);
  if (codeVersion === 2) {
    for (const resolution of DEPA_AI_RESOURCE_KIND_SPEC_RESOLUTIONS) resolutions.register(resolution);
  }
  return {
    contracts,
    readers,
    readerProfile,
    resolutions,
  };
}

const schemaValidator: JsonSchemaValidator = {
  validate(revision: KindSpecRevision, value: PortableSpec): readonly string[] {
    return validateSchema(revision.specSchema, value, '$');
  },
};

function validateSchema(schema: JsonSchema, value: unknown, path: string): readonly string[] {
  if (typeof schema === 'boolean') return schema ? [] : [`${path} rejected`];
  const issues: string[] = [];
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((choice) => validateSchema(choice as JsonSchema, value, path).length === 0).length;
    if (matches !== 1) issues.push(`${path} must match exactly one shape`);
  }
  if ('const' in schema && value !== schema.const) issues.push(`${path} must equal ${schema.const}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) issues.push(`${path} is not an allowed value`);
  const expectedType = schema.type;
  if (expectedType === 'object') {
    if (!isRecord(value)) return [`${path} must be object`];
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(value, key)) {
        issues.push(`${path}.${key} is required`);
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          issues.push(...validateSchema(childSchema as JsonSchema, value[key], `${path}.${key}`));
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
            issues.push(`${path}.${key} is not allowed`);
          }
        }
      }
    }
  } else if (expectedType === 'array') {
    if (!Array.isArray(value)) issues.push(`${path} must be array`);
    else {
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) issues.push(`${path} has too many items`);
      if (typeof schema.items === 'boolean' || isRecord(schema.items)) {
        value.forEach((item, index) => issues.push(...validateSchema(schema.items as JsonSchema, item, `${path}[${index}]`)));
      }
    }
  } else if (expectedType === 'string') {
    if (typeof value !== 'string') issues.push(`${path} must be string`);
    else {
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) issues.push(`${path} is too short`);
      if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) issues.push(`${path} has invalid format`);
    }
  }
  return issues;
}

async function createResourcePackage(options: Readonly<{
  legacyManifest?: boolean;
  kindDefinitionOverride?: Readonly<{ kind: string; source: string }>;
  codeVersion?: 2;
  codeMutation?: (source: string) => string;
}> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'depa-ai-resource-contracts-'));
  temporaryRoots.add(root);
  await mkdir(join(root, 'KindDefinitions'), { recursive: true });
  await mkdir(join(root, 'Resources'), { recursive: true });

  const catalogs = [
    '    <Catalog #kind_definitions { kind = "KindDefinition" shape = "directory" root = "vfs://./KindDefinitions/" entry = "manifest.xnl" }>',
    ...DEPA_AI_RESOURCE_KINDS.map((kind, index) =>
      `    <Catalog #resource_${index} { kind = "${kind}" shape = "single-file" root = "vfs://./Resources/${kind}/" }>`,
    ),
  ];
  const manifestIdentity = options.legacyManifest
    ? 'apiVersion="halfcode.resources/v1" version="1.0.0"'
    : `envelopeVersion="${DEPA_AI_RESOURCE_ENVELOPE_VERSION}" specVersion=1`;
  await writeFile(join(root, 'manifest.xnl'), [
    `<ResourcePackage #depa.flows.test.contracts ${manifestIdentity} (`,
    '  <Catalogs [',
    ...catalogs,
    '  ]>',
    ')>',
    '',
  ].join('\n'));

  for (const kind of DEPA_AI_RESOURCE_KINDS) {
    const version = options.codeVersion === 2 && (kind === 'AgentMessageSource' || kind === 'AgentContextPipeline') ? 2 : 1;
    const contract = depaAIResourceKindContract(kind, version);
    const definitionDir = join(root, 'KindDefinitions', contract.kind);
    const resourceDir = join(root, 'Resources', contract.kind);
    await mkdir(definitionDir, { recursive: true });
    await mkdir(resourceDir, { recursive: true });
    const definitionSource = options.kindDefinitionOverride?.kind === contract.kind
      ? options.kindDefinitionOverride.source
      : contract.kindDefinitionSource;
    await writeFile(join(definitionDir, 'manifest.xnl'), definitionSource);
    await writeFile(
      join(resourceDir, 'Example.xnl'),
      version === 2 ? (options.codeMutation ?? ((source) => source))(nativeCodeSource(kind)) : minimalResourceSource(kind),
    );
  }
  return root;
}

function nativeCodeSource(kind: string): string {
  return `<${kind} #depa.flows.test.${kind} envelopeVersion="${DEPA_AI_RESOURCE_ENVELOPE_VERSION}" specVersion=2 { lifecycle = "Stable" description = "Native recipe" } (
    <CodeBinding { packageName = "test.recipes" module = "./source.ts" exportName = "compile" }>
    <Config { value = { enabled = true nested = [1 "two" null] } }>
    <Assets [<Asset #template { path = "template.txt" format = "text" }>]>
    <DependencyRefs [<DependencyRef #prompt { kind = "Prompt" ref = "resource://depa.flows.test.Prompt" }>]>
  )>`;
}

function minimalResourceSource(kind: string): string {
  const identity = `<${kind} #depa.flows.test.${kind} envelopeVersion="${DEPA_AI_RESOURCE_ENVELOPE_VERSION}" specVersion=1`;
  switch (kind) {
    case 'AIAgentDefinition':
      return `${identity} (\n  <ToolRefs []>\n  <MaterialPortRefs []>\n)>\n`;
    case 'AgentMessageSource':
    case 'AgentContextPipeline':
      return `${identity} (\n  <Content ?>export function compile() { return [] }</?>\n)>\n`;
    case 'Prompt':
      return `${identity} { template = "test" }>\n`;
    case 'MessageSchema':
      return `${identity} { schema = { type = "object" } }>\n`;
    case 'EffectPolicy':
      return `${identity} { toolMode = "none" }>\n`;
    case 'MaterialPort':
      return `${identity} { materialKind = "RequestMaterial" required = false cardinality = "one" }>\n`;
    case 'MaterialBinding':
      return `${identity} (\n  <AgentTaskRef>\n  <PortRef>\n  <MaterialRef>\n)>\n`;
    case 'RequestMaterial':
    case 'ContextMaterial':
      return `${identity} { value = "test" }>\n`;
    case 'AIWorkflowAppBundle':
      return `${identity} (\n  <WorkflowBindings []>\n)>\n`;
    default:
      return `${identity}>\n`;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
