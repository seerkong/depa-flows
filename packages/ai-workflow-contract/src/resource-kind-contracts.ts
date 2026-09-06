import {
  digestCanonical,
  type JsonSchema,
  type KindReaderRegistration,
  type KindSemanticContract,
  type KindSpecRevision,
  type KindSubjectOwner,
  type PortableSpec,
  type SpecResolutionDefinition,
} from 'halfcode-compiler.xnl/resource-core';
import {
  createKindSpecRevision,
  createKindSubjectOwner,
} from 'halfcode-compiler.xnl/kind-definition';

export const DEPA_AI_RESOURCE_KINDS = Object.freeze([
  'AIAgentDefinition',
  'AgentMessageSource',
  'AgentContextPipeline',
  'Prompt',
  'Tool',
  'MessageSchema',
  'EffectPolicy',
  'MaterialPort',
  'MaterialBinding',
  'RequestMaterial',
  'ContextMaterial',
  'AIWorkflowAppBundle',
  'AICtrlWorkflow',
  'AIDataWorkflow',
] as const);

export type DepaAIResourceKind = (typeof DEPA_AI_RESOURCE_KINDS)[number];

export const DEPA_AI_RESOURCE_ENVELOPE_VERSION = 'halfcode.resource-envelope/v1' as const;
export const DEPA_AI_RESOURCE_SPEC_VERSION = 1 as const;
export const DEPA_AI_RESOURCE_KIND_OWNER_PACKAGE_ID = 'ai-workflow-contract' as const;
export const DEPA_AI_RESOURCE_SEMANTIC_API_VERSION = 'depa.flows/v1' as const;

const subjectFqnFor = (kind: DepaAIResourceKind): `Depa.Flows.KindDefinition.${DepaAIResourceKind}` =>
  `Depa.Flows.KindDefinition.${kind}`;

export const DEPA_AI_RESOURCE_KIND_OWNER_PACKAGE_FINGERPRINT = digestCanonical(Object.freeze({
  authority: 'ai-workflow-contract/depa-ai-resource-kinds/v1',
  ownerPackageId: DEPA_AI_RESOURCE_KIND_OWNER_PACKAGE_ID,
  subjects: Object.freeze(DEPA_AI_RESOURCE_KINDS.map(subjectFqnFor).sort(compareCodeUnits)),
  semanticContractVersion: DEPA_AI_RESOURCE_SEMANTIC_API_VERSION,
}));

interface KindSchemaShape {
  readonly requiredProperties?: readonly string[];
  readonly requiredSubdomains?: readonly string[];
}

const KIND_SCHEMA_SHAPES: Readonly<Record<DepaAIResourceKind, KindSchemaShape>> = Object.freeze({
  AIAgentDefinition: Object.freeze({ requiredSubdomains: Object.freeze(['ToolRefs', 'MaterialPortRefs']) }),
  AgentMessageSource: Object.freeze({ requiredSubdomains: Object.freeze(['Content']) }),
  AgentContextPipeline: Object.freeze({ requiredSubdomains: Object.freeze(['Content']) }),
  Prompt: Object.freeze({ requiredProperties: Object.freeze(['template']) }),
  Tool: Object.freeze({}),
  MessageSchema: Object.freeze({ requiredProperties: Object.freeze(['schema']) }),
  EffectPolicy: Object.freeze({ requiredProperties: Object.freeze(['toolMode']) }),
  MaterialPort: Object.freeze({ requiredProperties: Object.freeze(['materialKind', 'required', 'cardinality']) }),
  MaterialBinding: Object.freeze({ requiredSubdomains: Object.freeze(['AgentTaskRef', 'PortRef', 'MaterialRef']) }),
  RequestMaterial: Object.freeze({ requiredProperties: Object.freeze(['value']) }),
  ContextMaterial: Object.freeze({ requiredProperties: Object.freeze(['value']) }),
  AIWorkflowAppBundle: Object.freeze({ requiredSubdomains: Object.freeze(['WorkflowBindings']) }),
  AICtrlWorkflow: Object.freeze({}),
  AIDataWorkflow: Object.freeze({}),
});

const KIND_SEMANTIC_OPERATIONS: Readonly<Record<DepaAIResourceKind, readonly string[]>> = Object.freeze({
  AIAgentDefinition: Object.freeze(['projectAIWorkflowAgentResources', 'freezeAIAgentTaskResources']),
  AgentMessageSource: Object.freeze(['projectAIWorkflowAgentResources', 'compileAgentMessageSource']),
  AgentContextPipeline: Object.freeze(['projectAIWorkflowAgentResources', 'compileAgentContextPipeline']),
  Prompt: Object.freeze(['projectAIWorkflowAgentResources', 'compileAgentMessagePrefix']),
  Tool: Object.freeze(['projectAIWorkflowAgentResources', 'freezeAIAgentTaskResources']),
  MessageSchema: Object.freeze(['projectAIWorkflowAgentResources', 'validateExecutableMessageSchema']),
  EffectPolicy: Object.freeze(['projectAIWorkflowAgentResources', 'validateExecutableEffectPolicy']),
  MaterialPort: Object.freeze(['projectAIWorkflowAgentResources', 'validateMaterialPortBindings']),
  MaterialBinding: Object.freeze(['projectAIWorkflowAgentResources', 'freezeAIAgentTaskResources']),
  RequestMaterial: Object.freeze(['projectAIWorkflowAgentResources', 'projectMaterialValue']),
  ContextMaterial: Object.freeze(['projectAIWorkflowAgentResources', 'projectMaterialValue']),
  AIWorkflowAppBundle: Object.freeze(['projectAIWorkflowAppBundles']),
  AICtrlWorkflow: Object.freeze(['loadAICtrlWorkflowSources', 'projectAIWorkflowAppBundles']),
  AIDataWorkflow: Object.freeze(['loadAIDataWorkflowSources', 'projectAIWorkflowAppBundles']),
});

const KIND_REFERENCE_ROLES: Readonly<Record<DepaAIResourceKind, readonly string[]>> = Object.freeze({
  AIAgentDefinition: Object.freeze([
    'message-prompt',
    'message-schema',
    'message-source',
    'context-pipeline',
    'input-schema',
    'output-schema',
    'tool',
    'effect-policy',
    'material-port',
  ]),
  AgentMessageSource: Object.freeze([]),
  AgentContextPipeline: Object.freeze([]),
  Prompt: Object.freeze([]),
  Tool: Object.freeze([]),
  MessageSchema: Object.freeze([]),
  EffectPolicy: Object.freeze([]),
  MaterialPort: Object.freeze(['schema']),
  MaterialBinding: Object.freeze(['agent-task', 'material-port', 'material-value']),
  RequestMaterial: Object.freeze([]),
  ContextMaterial: Object.freeze([]),
  AIWorkflowAppBundle: Object.freeze(['workflow-binding']),
  AICtrlWorkflow: Object.freeze([]),
  AIDataWorkflow: Object.freeze([]),
});

export interface DepaAIResourceKindContract {
  readonly kind: DepaAIResourceKind;
  readonly subjectFqn: `Depa.Flows.KindDefinition.${DepaAIResourceKind}`;
  readonly owner: KindSubjectOwner;
  readonly revision: KindSpecRevision;
  readonly reader: KindReaderRegistration<PortableSpec>;
  readonly kindDefinitionSource: string;
}

function authoredSpecSchema(kind: DepaAIResourceKind): JsonSchema {
  const shape = KIND_SCHEMA_SHAPES[kind];
  const propertiesSchema = Object.freeze({
    type: 'object',
    ...(shape.requiredProperties && shape.requiredProperties.length > 0
      ? { required: Object.freeze([...shape.requiredProperties]) }
      : {}),
  });
  const subdomainsSchema = Object.freeze({
    type: 'object',
    ...(shape.requiredSubdomains && shape.requiredSubdomains.length > 0
      ? { required: Object.freeze([...shape.requiredSubdomains]) }
      : {}),
  });
  return Object.freeze({
    type: 'object',
    required: Object.freeze(['properties', 'body', 'subdomains']),
    properties: Object.freeze({
      properties: propertiesSchema,
      body: Object.freeze({ type: 'array' }),
      subdomains: subdomainsSchema,
      text: Object.freeze({ type: 'string' }),
    }),
    additionalProperties: false,
  });
}

/** Native code recipes have a separate writer contract; legacy Content stays spec 1. */
function nativeCodeSpecSchema(): JsonSchema {
  const string = Object.freeze({ type: 'string', minLength: 1, pattern: '^\\S(?:[\\s\\S]*\\S)?$' });
  const emptyObject = Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false });
  const emptyBody = Object.freeze({ type: 'array', maxItems: 0 });
  const node = (tag: string, properties: JsonSchema, body: JsonSchema = emptyBody): JsonSchema => Object.freeze({
    type: 'object',
    required: Object.freeze(['tag', 'metadata', 'properties', 'body', 'subdomains']),
    properties: Object.freeze({
      tag: Object.freeze({ const: tag }),
      resourceId: string,
      metadata: emptyObject,
      properties,
      body,
      subdomains: emptyObject,
    }),
    additionalProperties: false,
  });
  const closedProperties = (properties: Readonly<Record<string, JsonSchema>>, required = Object.keys(properties)): JsonSchema => Object.freeze({
    type: 'object', required: Object.freeze(required), properties: Object.freeze(properties), additionalProperties: false,
  });
  return Object.freeze({
    type: 'object',
    required: Object.freeze(['properties', 'body', 'subdomains']),
    properties: Object.freeze({
      properties: closedProperties({ lifecycle: string, description: Object.freeze({ type: 'string' }) }, []),
      body: emptyBody,
      subdomains: closedProperties({
        CodeBinding: node('CodeBinding', closedProperties({ packageName: string, module: string, exportName: string })),
        Config: node('Config', closedProperties({ value: Object.freeze({ type: 'object' }) })),
        Assets: node('Assets', emptyObject, Object.freeze({
          type: 'array',
          items: node('Asset', closedProperties({ path: string, format: Object.freeze({ enum: Object.freeze(['text', 'json']) }) })),
        })),
        DependencyRefs: node('DependencyRefs', emptyObject, Object.freeze({
          type: 'array',
          items: node('DependencyRef', closedProperties({
            kind: string,
            ref: Object.freeze({ type: 'string', pattern: '^resource://\\S+$' }),
          })),
        })),
      }, ['CodeBinding']),
    }),
    additionalProperties: false,
  });
}

function codeRecipeSpecSchema(kind: DepaAIResourceKind): JsonSchema {
  const legacy = authoredSpecSchema(kind) as Readonly<Record<string, unknown>>;
  return Object.freeze({
    oneOf: Object.freeze([
      nativeCodeSpecSchema(),
      Object.freeze({
        ...legacy,
        properties: Object.freeze({
          ...(legacy.properties as Readonly<Record<string, unknown>>),
          subdomains: Object.freeze({
            type: 'object', required: Object.freeze(['Content']),
            properties: Object.freeze({ CodeBinding: false }),
          }),
        }),
      }),
    ]),
  });
}

function nativeCodeSemanticContract(kind: DepaAIResourceKind): KindSemanticContract {
  const authority = 'ai-workflow-contract/depa-ai-resource-kinds/v2';
  return Object.freeze({
    semanticValidatorFingerprint: digestCanonical(Object.freeze({
      authority, kind, role: 'closed-native-code-recipe-validation',
      fields: Object.freeze(['CodeBinding', 'Config', 'Assets', 'DependencyRefs']),
      config: 'closed-json-object', assets: 'source-root-relative-text-or-json',
      legacy: 'exclusive-Content-requires-explicit-compatibility-resolver',
    })),
    referenceProjectionFingerprint: digestCanonical(Object.freeze({
      authority, kind, role: 'typed-resource-reference-projection', relations: Object.freeze(['code-dependency']),
    })),
    compilerInputFingerprint: digestCanonical(Object.freeze({
      authority, kind, role: 'native-code-binding-and-frozen-closure-projection',
      fields: Object.freeze(['packageName', 'module', 'exportName', 'config', 'assets', 'dependencyRefs']),
    })),
  });
}

function semanticContract(kind: DepaAIResourceKind): KindSemanticContract {
  return Object.freeze({
    semanticValidatorFingerprint: digestCanonical(Object.freeze({
      authority: 'ai-workflow-contract/depa-ai-resource-kinds/v1',
      kind,
      role: 'closed-domain-semantic-validation',
      operations: KIND_SEMANTIC_OPERATIONS[kind],
    })),
    referenceProjectionFingerprint: digestCanonical(Object.freeze({
      authority: 'ai-workflow-contract/depa-ai-resource-kinds/v1',
      kind,
      role: 'typed-resource-reference-projection',
      relations: KIND_REFERENCE_ROLES[kind],
    })),
    compilerInputFingerprint: digestCanonical(Object.freeze({
      authority: 'ai-workflow-contract/depa-ai-resource-kinds/v1',
      kind,
      role: 'authored-spec-envelope-projection',
      fields: Object.freeze(['properties', 'body', 'subdomains', 'text']),
    })),
  });
}

function readerRegistration(
  kind: DepaAIResourceKind,
  revision: KindSpecRevision,
): KindReaderRegistration<PortableSpec> {
  const readerId = `ai-workflow-contract.${kind}.reader.v${revision.specVersion}`;
  return Object.freeze({
    readerId,
    subjectFqn: revision.subjectFqn,
    readerSpecVersion: revision.specVersion,
    contractFingerprint: revision.contractFingerprint,
    readerImplementationFingerprint: digestCanonical(Object.freeze({
      authority: `ai-workflow-contract/depa-ai-resource-kinds/v${revision.specVersion}`,
      readerId,
      kind,
      contractFingerprint: revision.contractFingerprint,
      operations: KIND_SEMANTIC_OPERATIONS[kind],
      implementation: 'identity-read-of-halfcode-validated-portable-spec',
    })),
    compatibilityPolicy: revision.specVersion === 1 ? 'exact' : 'backward-transitive',
    read: (spec: PortableSpec): PortableSpec => spec,
  });
}

function renderKindDefinition(owner: KindSubjectOwner, revisions: readonly KindSpecRevision[]): string {
  return [
    `<KindDefinition #${owner.subjectFqn} envelopeVersion="${DEPA_AI_RESOURCE_ENVELOPE_VERSION}" specVersion=1 {`,
    '  lifecycle = "Stable"',
    `  resourceKind = "${owner.kind}"`,
    `  subjectFqn = "${owner.subjectFqn}"`,
    '  sourceShapes = ["single-file"]',
    `  documentCardinality = "${owner.sourceContract.documentCardinality}"`,
    `  description = "Canonical depa-flows ${owner.kind} resource contract."`,
    '} (',
    '  <SpecRevisions [',
    ...revisions.flatMap((revision) => [
      `    <SpecRevision #v${revision.specVersion} {`,
      `      specVersion = ${revision.specVersion}`,
      `      schemaRef = "vfs://./spec-v${revision.specVersion}.schema.json"`,
      `      schemaFingerprint = "${revision.schemaFingerprint}"`,
      `      contractFingerprint = "${revision.contractFingerprint}"`,
      `      semanticValidatorFingerprint = "${revision.semanticContract.semanticValidatorFingerprint}"`,
      `      referenceProjectionFingerprint = "${revision.semanticContract.referenceProjectionFingerprint}"`,
      `      compilerInputFingerprint = "${revision.semanticContract.compilerInputFingerprint}"`,
      `      stability = "${revision.stability}"`,
      '    }>',
    ]),
    '  ]>',
    ')>',
    '',
  ].join('\n');
}

function createContract(kind: DepaAIResourceKind): DepaAIResourceKindContract {
  const subjectFqn = subjectFqnFor(kind);
  const owner = createKindSubjectOwner({
    kind,
    subjectFqn,
    ownerPackageId: DEPA_AI_RESOURCE_KIND_OWNER_PACKAGE_ID,
    ownerPackageFingerprint: DEPA_AI_RESOURCE_KIND_OWNER_PACKAGE_FINGERPRINT,
    sourceShapes: Object.freeze(['single-file']),
    documentCardinality: 'one',
  });
  const revision = createKindSpecRevision({
    kind,
    subjectFqn,
    specVersion: DEPA_AI_RESOURCE_SPEC_VERSION,
    specSchema: authoredSpecSchema(kind),
    semanticContract: semanticContract(kind),
    sourceContractFingerprint: owner.sourceContract.sourceContractFingerprint,
    stability: 'stable',
  });
  return Object.freeze({
    kind,
    subjectFqn,
    owner,
    revision,
    reader: readerRegistration(kind, revision),
    kindDefinitionSource: renderKindDefinition(owner, [revision]),
  });
}

const LEGACY_KIND_CONTRACTS = DEPA_AI_RESOURCE_KINDS.map(createContract);

export const DEPA_AI_RESOURCE_KIND_CONTRACTS: readonly DepaAIResourceKindContract[] = Object.freeze([
  ...LEGACY_KIND_CONTRACTS,
  ...LEGACY_KIND_CONTRACTS.filter(({ kind }) => kind === 'AgentMessageSource' || kind === 'AgentContextPipeline').map((legacy) => {
    const { kind } = legacy;
    const revision = createKindSpecRevision({
      kind,
      subjectFqn: legacy.subjectFqn,
      specVersion: 2,
      specSchema: codeRecipeSpecSchema(kind),
      semanticContract: nativeCodeSemanticContract(kind),
      sourceContractFingerprint: legacy.owner.sourceContract.sourceContractFingerprint,
      stability: 'stable',
    });
    return Object.freeze({
      ...legacy,
      revision,
      reader: readerRegistration(kind, revision),
      kindDefinitionSource: renderKindDefinition(legacy.owner, [legacy.revision, revision]),
    });
  }),
]);

export const DEPA_AI_RESOURCE_KIND_OWNERS: readonly KindSubjectOwner[] = Object.freeze(
  LEGACY_KIND_CONTRACTS.map((contract) => contract.owner),
);

export const DEPA_AI_RESOURCE_KIND_SPEC_REVISIONS: readonly KindSpecRevision[] = Object.freeze(
  DEPA_AI_RESOURCE_KIND_CONTRACTS.map((contract) => contract.revision),
);

export const DEPA_AI_RESOURCE_KIND_READER_REGISTRATIONS: readonly KindReaderRegistration<PortableSpec>[] = Object.freeze(
  DEPA_AI_RESOURCE_KIND_CONTRACTS.map((contract) => contract.reader),
);

const CONTRACTS_BY_KIND: ReadonlyMap<string, DepaAIResourceKindContract> = new Map(
  DEPA_AI_RESOURCE_KIND_CONTRACTS.map((contract) => [`${contract.kind}@${contract.revision.specVersion}`, contract]),
);

export function depaAIResourceKindContract(kind: DepaAIResourceKind, specVersion: number = DEPA_AI_RESOURCE_SPEC_VERSION): DepaAIResourceKindContract {
  const contract = CONTRACTS_BY_KIND.get(`${kind}@${specVersion}`);
  if (!contract) throw new Error(`Unknown depa AI resource Kind '${kind}' spec version '${specVersion}'.`);
  return contract;
}

export const DEPA_AI_RESOURCE_KIND_SPEC_RESOLUTIONS: readonly SpecResolutionDefinition[] = Object.freeze(
  DEPA_AI_RESOURCE_KIND_CONTRACTS.filter((contract) => contract.revision.specVersion === 2).map((contract) => {
    const writer = depaAIResourceKindContract(contract.kind, 1);
    const identity = Object.freeze({
      id: `ai-workflow-contract.${contract.kind}.v1-to-v2`,
      subjectFqn: contract.subjectFqn,
      ownerPackageId: contract.owner.ownerPackageId,
      ownerPackageFingerprint: contract.owner.ownerPackageFingerprint,
      writerSpecVersion: 1,
      readerSpecVersion: 2,
      writerContractFingerprint: writer.revision.contractFingerprint,
      readerContractFingerprint: contract.revision.contractFingerprint,
    });
    return Object.freeze({
      ...identity,
      resolutionFingerprint: digestCanonical(Object.freeze({
        ...identity,
        implementation: 'identity-Content-preservation-requires-explicit-legacy-code-resolver',
      })),
      resolve: (spec: PortableSpec): PortableSpec => spec,
    });
  }),
);

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
