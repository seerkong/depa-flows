import fs from 'node:fs';
import path from 'node:path';
import type { DefinitionStepAssemblyRuntime } from 'flow-step-space-contract';
import type { DefinitionStepProfileLoadOptions } from 'flow-step-space-contract';
import {
  assembleDefinitionStepProfileSourcesWithRuntime,
  DefinitionStepAssemblyError,
  normalizeDefinitionStepSourceRef,
} from './index.js';

export interface FilesystemDefinitionStepRuntimeOptions {
  /** Host policy lives in the runtime adapter, never in semantic Processor input. */
  readonly rootDir: string;
  readonly extensionCodecs?: DefinitionStepAssemblyRuntime['extensionCodecs'];
}

export interface FilesystemDefinitionStepProfileRuntime extends DefinitionStepAssemblyRuntime {
  readonly profileSources: {
    readTopLevelXnlSources(): readonly { readonly ref: string; readonly content: string }[];
  };
}

export interface AssembleDefinitionStepProfileDirectoryInput {}

export interface AssembleDefinitionStepProfileDirectoryConfig extends DefinitionStepProfileLoadOptions {
  readonly profileRoot: string;
}

export function createFilesystemDefinitionStepRuntime(
  options: FilesystemDefinitionStepRuntimeOptions,
): DefinitionStepAssemblyRuntime {
  const root = fs.realpathSync(path.resolve(options.rootDir));
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw diagnostic('step-source-root-invalid', 'StepSpace runtime root must be a regular directory');
  }
  return Object.freeze({
    sources: Object.freeze({
      readSource(refValue: string): Uint8Array {
        const ref = normalizeDefinitionStepSourceRef(refValue);
        const file = path.resolve(root, ...ref.split('/'));
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw diagnostic('step-source-ref-invalid', `${ref} escapes the runtime root`, ref);
        }
        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(file);
        } catch (error) {
          throw diagnostic('step-source-not-found', `${ref}: ${(error as Error).message}`, ref);
        }
        if (stat.isSymbolicLink()) throw diagnostic('step-source-link-unsupported', `${ref} must not be a symbolic link`, ref);
        if (!stat.isFile()) throw diagnostic('step-source-file-invalid', `${ref} must be a regular file`, ref);
        const realFile = fs.realpathSync(file);
        const realRelative = path.relative(root, realFile);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
          throw diagnostic('step-source-ref-invalid', `${ref} resolves outside the runtime root`, ref);
        }
        return new Uint8Array(fs.readFileSync(realFile));
      },
    }),
    extensionCodecs: options.extensionCodecs ?? Object.freeze({ resolve: () => undefined }),
  });
}

export function createFilesystemDefinitionStepProfileRuntime(
  options: FilesystemDefinitionStepRuntimeOptions,
): FilesystemDefinitionStepProfileRuntime {
  const absoluteRoot = path.resolve(options.rootDir);
  const stepRuntime = createFilesystemDefinitionStepRuntime(options);
  return Object.freeze({
    ...stepRuntime,
    profileSources: Object.freeze({
      readTopLevelXnlSources() {
        return fs.readdirSync(absoluteRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.xnl'))
          .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
          .map((entry) => Object.freeze({
            ref: entry.name,
            content: fs.readFileSync(path.join(absoluteRoot, entry.name), 'utf8'),
          }));
      },
    }),
  });
}

/** Processor authority; the host root is closed inside the runtime adapter. */
export function assembleDefinitionStepProfileDirectory(
  runtime: FilesystemDefinitionStepProfileRuntime,
  _input: AssembleDefinitionStepProfileDirectoryInput,
  config: AssembleDefinitionStepProfileDirectoryConfig,
) {
  if (!runtime?.profileSources || typeof runtime.profileSources.readTopLevelXnlSources !== 'function') {
    throw diagnostic('step-profile-runtime-invalid', 'runtime.profileSources.readTopLevelXnlSources is required');
  }
  const sources = runtime.profileSources.readTopLevelXnlSources();
  return assembleDefinitionStepProfileSourcesWithRuntime(
    { sources: runtime.sources, extensionCodecs: runtime.extensionCodecs },
    sources,
    config.profileRoot,
    config,
  );
}

/** @deprecated Compatibility wrapper; new code must inject a filesystem runtime. */
export function assembleDefinitionStepProfileDirectoryFromRoot(
  rootDir: string,
  profileRoot: string,
  options: DefinitionStepProfileLoadOptions = {},
) {
  return assembleDefinitionStepProfileDirectory(
    createFilesystemDefinitionStepProfileRuntime({ rootDir }),
    {},
    { ...options, profileRoot },
  );
}

function diagnostic(code: string, message: string, sourceRef?: string): DefinitionStepAssemblyError {
  return new DefinitionStepAssemblyError({ code, message, ...(sourceRef ? { sourceRef } : {}) });
}
