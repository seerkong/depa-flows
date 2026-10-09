export interface PortEdge<I, P, E> {
  readonly id: E;
  readonly from: { readonly node: I; readonly port: P };
  readonly to: { readonly node: I; readonly port: P };
}
export interface ControlShape<P> {
  readonly role: "step" | "choice" | "loop" | "exit";
  readonly enter: P;
  readonly next?: P;
  readonly branches?: readonly {
    readonly port: P;
    readonly order: number;
    readonly default?: boolean;
  }[];
  readonly body?: P;
}
export interface PortControlGraph<N, I, P, E> {
  readonly entry: I;
  readonly nodes: readonly N[];
  readonly edges: readonly PortEdge<I, P, E>[];
}
export interface ControlGraphRuntime<N, I, P> {
  readonly nodeId: (node: N) => I;
  readonly shape: (node: N) => ControlShape<P>;
}
export type StructuredStatement<N, I, P> =
  | { readonly kind: "node"; readonly node: N }
  | {
      readonly kind: "choice";
      readonly node: N;
      readonly branches: readonly {
        readonly port: P;
        readonly body: readonly StructuredStatement<N, I, P>[];
      }[];
    }
  | {
      readonly kind: "loop";
      readonly node: N;
      readonly body: readonly StructuredStatement<N, I, P>[];
    }
  | { readonly kind: "block-ref"; readonly block: number; readonly source: I };
export interface StructuredForest<N, I, P> {
  readonly statements: readonly StructuredStatement<N, I, P>[];
  readonly blocks: readonly {
    readonly id: number;
    readonly source: I;
    readonly statements: readonly StructuredStatement<N, I, P>[];
  }[];
  readonly inferredNext: readonly { readonly owner: I; readonly next: I }[];
}
export interface GraphDiagnostic<I, E> {
  readonly code: string;
  readonly message: string;
  readonly node?: I;
  readonly edge?: E;
}
export type LowerGraphResult<N, I, P, E> =
  | { readonly ok: true; readonly forest: StructuredForest<N, I, P> }
  | {
      readonly ok: false;
      readonly diagnostics: readonly GraphDiagnostic<I, E>[];
    };
