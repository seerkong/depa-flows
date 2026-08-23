import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  EagerDataFlowCode,
  EagerDataFlowCodeResolver,
  EagerDataFlowLoadResult,
  EagerDataFlowXnlSource,
  LoadEagerDataFlowOptions,
} from 'eager-data-flow-contract';
import { loadEagerDataFlowSources } from './source-loader.js';
import {
  assembleDefinitionStepProfileDirectory,
  createFilesystemDefinitionStepProfileRuntime,
} from 'flow-step-space-logic/filesystem';

/** Filesystem convenience only; all parsing and validation stays in the source loader. */
export function loadEagerDataFlowDirectory(
  dir: string,
  options: LoadEagerDataFlowOptions = {},
): EagerDataFlowLoadResult {
  const absoluteDir = path.resolve(dir);
  const sources: EagerDataFlowXnlSource[] = fs.existsSync(absoluteDir)
    ? fs
        .readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.xnl'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          content: fs.readFileSync(path.join(absoluteDir, entry.name), 'utf8'),
        }))
    : [];
  const assembled = assembleDefinitionStepProfileDirectory(
    createFilesystemDefinitionStepProfileRuntime({ rootDir: absoluteDir }),
    {},
    { ...(options.stepSpace ?? {}), profileRoot: 'EagerDataFlow' },
  );
  if (assembled.diagnostics.length > 0) {
    return { diagnostics: assembled.diagnostics.map(({ code, message, sourceRef }) => ({
      code,
      message,
      ...(sourceRef ? { source: sourceRef } : {}),
    })) };
  }
  const effectiveSources: EagerDataFlowXnlSource[] = assembled.forest
    ? (assembled.sources as readonly ({ readonly ref: string; readonly content: string } | { readonly name: string; readonly content: string })[])
        .map((source) => ({ name: 'name' in source ? source.name : source.ref, content: source.content }))
    : sources;
  const loaded = loadEagerDataFlowSources(effectiveSources, {
    ...options,
    baseUri: options.baseUri ?? absoluteDir,
  });
  return loaded.plan && assembled.forest
    ? { ...loaded, plan: { ...loaded.plan, definitionStepForest: assembled.forest } }
    : loaded;
}

export type EagerDataFlowModuleImporter = (
  specifier: string,
) => Promise<Readonly<Record<string, unknown>>>;

/** Creates an explicit filesystem-backed VFS resolver; the module importer is always caller-owned. */
export function createFilesystemCodeResolver<Runtime = unknown>(
  importModule: EagerDataFlowModuleImporter,
): EagerDataFlowCodeResolver<Runtime> {
  const modules = new Map<string, Promise<Readonly<Record<string, unknown>>>>();
  return async ({ reference, baseUri, flowId, nodeId }) => {
    const match = /^vfs:\/\/\.\/(.+)#([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(reference);
    if (!match) throw new Error(`unsupported filesystem VFS reference: ${reference}`);
    if (!baseUri) throw new Error(`${flowId}#${nodeId} has no baseUri for ${reference}`);
    const root = path.resolve(baseUri);
    const file = path.resolve(root, match[1]);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${reference} escapes EagerDataFlow baseUri`);
    }
    const specifier = pathToFileURL(file).href;
    let loaded = modules.get(specifier);
    if (!loaded) {
      loaded = importModule(specifier);
      modules.set(specifier, loaded);
    }
    const exported = (await loaded)[match[2]];
    if (typeof exported !== 'function') {
      throw new Error(`${reference} does not identify a function export`);
    }
    return exported as EagerDataFlowCode<Runtime>;
  };
}
