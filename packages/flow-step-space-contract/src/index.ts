/** JSON-shaped facts retained by the profile-neutral StepSpace domain. */
export type DefinitionStepValue =
  | string
  | number
  | boolean
  | null
  | readonly DefinitionStepValue[]
  | { readonly [key: string]: DefinitionStepValue };

/** A virtual resource-local reference. It is never a host filesystem path. */
export type DefinitionStepSourceRef = string;
export type DefinitionStepDigest = `sha256:${string}`;

export interface DefinitionStepDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourceRef?: DefinitionStepSourceRef;
  readonly stepId?: string;
}

/** Named virtual source input; loaders must resolve it through an explicit runtime port. */
export interface DefinitionStepSource {
  readonly ref: DefinitionStepSourceRef;
  readonly content: string;
}

export type DefinitionStepSourceCollection =
  | readonly DefinitionStepSource[]
  | Readonly<Record<string, string>>;

export interface DefinitionStepSourceReadPort {
  readSource(ref: DefinitionStepSourceRef): Uint8Array;
}

export interface DefinitionStepAssemblyRuntime {
  readonly sources: DefinitionStepSourceReadPort;
  readonly extensionCodecs: DefinitionStepExtensionCodecRegistryPort;
}

export interface DefinitionStepAssemblyInput {
  readonly stepSpaceRef: DefinitionStepSourceRef;
}

export interface DefinitionStepExtensionCodecContext {
  readonly kind: string;
  readonly schemaRef?: string;
  readonly sourceRef: DefinitionStepSourceRef;
  readonly stepId: string;
}

/** Runtime-only pure codec seam. Implementations are never persisted in a forest. */
export interface DefinitionStepExtensionCodec {
  normalize(
    value: DefinitionStepValue,
    context: DefinitionStepExtensionCodecContext,
  ): DefinitionStepValue;
}

export interface DefinitionStepExtensionRegistration {
  readonly schemaRef?: string;
  readonly codec: DefinitionStepExtensionCodec;
}

/** Long-lived runtime registry. Codec functions never cross a data/config boundary. */
export interface DefinitionStepExtensionCodecRegistryPort {
  resolve(kind: string): DefinitionStepExtensionRegistration | undefined;
}

export interface DefinitionStepAssemblyConfig {}

/** Profile-neutral projection of one exact executable node held by a Step Core. */
export interface DefinitionStepCoreNode {
  readonly tag: string;
  readonly id?: string;
  readonly metadata: Readonly<Record<string, DefinitionStepValue>>;
  readonly attrs: Readonly<Record<string, DefinitionStepValue>>;
  readonly children: readonly DefinitionStepCoreNode[];
  readonly sections: Readonly<Record<string, DefinitionStepCoreNode>>;
}

export interface DefinitionStepExtension {
  readonly id: string;
  readonly kind: string;
  readonly sourceRef: DefinitionStepSourceRef;
  readonly schemaRef?: string;
  readonly value: DefinitionStepValue;
  readonly digest: DefinitionStepDigest;
}

export interface DefinitionStep {
  readonly id: string;
  readonly sourceRef: DefinitionStepSourceRef;
  readonly core: DefinitionStepCoreNode;
  readonly extensions: Readonly<Record<string, DefinitionStepExtension>>;
  readonly digest: DefinitionStepDigest;
}

export interface DefinitionStepLeaf {
  readonly kind: 'step';
  readonly stepId: string;
}

export interface DefinitionStepGroup {
  readonly kind: 'group';
  readonly id: string;
  readonly sourceRef?: DefinitionStepSourceRef;
  readonly children: readonly DefinitionStepForestNode[];
}

export type DefinitionStepForestNode = DefinitionStepLeaf | DefinitionStepGroup;

/** One exact source closure entry, ordered by first traversal from the root ref. */
export interface DefinitionStepClosureEntry {
  readonly ref: DefinitionStepSourceRef;
  readonly digest: DefinitionStepDigest;
  readonly content: string;
}

/** Immutable definition authority; it is distinct from any run-state index. */
export interface DefinitionStepForest {
  readonly schemaVersion: 'depa.definition-step-forest/v1';
  readonly id: string;
  readonly apiVersion: string;
  readonly version: string;
  readonly rootRef: DefinitionStepSourceRef;
  readonly roots: readonly DefinitionStepForestNode[];
  readonly steps: Readonly<Record<string, DefinitionStep>>;
  readonly stepOrder: readonly string[];
  readonly closure: readonly DefinitionStepClosureEntry[];
  readonly artifactDigest: DefinitionStepDigest;
}

export interface DefinitionStepProfileLoadOptions {
  /** Exact virtual source containing the profile root; defaults to manifest.xnl. */
  readonly profileSourceRef?: DefinitionStepSourceRef;
}

export interface DefinitionStepProfileAssemblyInput {
  readonly sources: DefinitionStepSourceCollection;
}

export interface DefinitionStepProfileAssemblyConfig extends DefinitionStepProfileLoadOptions {
  readonly profileRoot: string;
}

export interface DefinitionStepMutationPort {
  readStep(stepId: string): DefinitionStep | undefined;
  writeStep(step: DefinitionStep, expectedDigest: DefinitionStepDigest): void;
}

export interface DefinitionStepMutationRuntime {
  readonly steps: DefinitionStepMutationPort;
  readonly extensionCodecs: DefinitionStepExtensionCodecRegistryPort;
}

export interface DefinitionStepSelector {
  readonly stepId: string;
}

export interface DefinitionStepMutationInvocation {
  readonly expectedDigest: DefinitionStepDigest;
  readonly core?: DefinitionStepCoreNode;
  readonly extensions?: Readonly<Record<string, DefinitionStepValue>>;
}

export interface DefinitionStepMutationConfig {}

/** Future run projection identity. It is deliberately not a DefinitionStepForest. */
export interface RunStepStateIndexIdentity {
  readonly schemaVersion: 'depa.run-step-state-index/v1';
  readonly rootDigest: DefinitionStepDigest;
}

/** Semantic-neutral immutable payload record used by the later filesystem owner. */
export interface ImmutableStepRecord {
  readonly schemaVersion: 'depa.immutable-step-record/v1';
  readonly key: string;
  readonly value: DefinitionStepValue;
  readonly digest: DefinitionStepDigest;
}

export interface StepMerkleLeaf {
  readonly kind: 'leaf';
  readonly key: string;
  readonly recordDigest: DefinitionStepDigest;
  readonly digest: DefinitionStepDigest;
}

export interface StepMerkleBranch {
  readonly kind: 'branch';
  readonly firstKey: string;
  readonly lastKey: string;
  readonly leftDigest: DefinitionStepDigest;
  readonly rightDigest: DefinitionStepDigest;
  readonly digest: DefinitionStepDigest;
}

export type StepMerkleNode = StepMerkleLeaf | StepMerkleBranch;

/** Pure content-addressed tree. It performs no IO and admits no current head. */
export interface StepMerkleTree {
  readonly schemaVersion: 'depa.step-merkle-tree/v1';
  readonly rootDigest: DefinitionStepDigest;
  readonly keyOrder: readonly string[];
  readonly leafByKey: Readonly<Record<string, DefinitionStepDigest>>;
  readonly nodes: Readonly<Record<string, StepMerkleNode>>;
}

export interface StepMerkleDiff {
  readonly addedNodeDigests: readonly DefinitionStepDigest[];
  readonly reusedNodeDigests: readonly DefinitionStepDigest[];
  readonly unreachableNodeDigests: readonly DefinitionStepDigest[];
}
