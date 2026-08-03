# Design

## Resource tree model

The AI workflow app bundle is an FS-native XNL resource tree:

- `manifest.xnl` is the app bundle entry.
- Catalog resources explicitly compose resource entries.
- Resource identity is declared by content `#id`/FQN, not inferred from file path.
- Directory shape may help authoring, but it is not resource composition by itself.

## XNL-only constraint

All new app bundle authoring examples and resources must be XNL. XML remains valid only for Codument control files such as behavior deltas and track metadata, not for flow resource definitions.

## Logical references

Allowed resource-facing schemes:

- `vfs://` for bundle/workspace files.
- `resource://` for declared resources by logical identity.
- `config://` for config facts.
- `secret://` for secret handles, never secret values.

Forbidden:

- host absolute paths;
- naked relative paths;
- `..` or encoded path escape;
- unregistered schemes;
- treating symlink traversal as authoring containment.

## Package additions

The resource/ref vocabulary belongs in `ai-workflow-contract`; pure validation helpers belong in `ai-workflow-logic`.

## Documentation additions

Add a focused `docs/flow-dsl/spec/ai-workflow/resources.md` page and link it from the DSL README. This page covers shared AI workflow resource authoring only; profile-specific nodes remain for later tracks.

## Validation

- Unit tests for allowed and rejected refs.
- Typecheck and full tests.
- Path hygiene search over tracked touched files.
