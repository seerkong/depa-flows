import { describe, expect, it, spyOn } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadFlowBundle } from 'instant-ctrl-flow-logic/filesystem';
import {
  annotateFlowFile,
  computeFlowBundleDigest,
  loadMaterializedFlowInstance,
  materializeFlowInstance,
  materializeInstance,
  normalizeFlowInstanceDescriptor,
  readFlowInstanceDescriptor,
} from '../src/instance.js';

const ROOT = path.resolve(import.meta.dir, '../../..');
const definition = () => path.join(ROOT, 'examples/xnl-bundles/order-fulfillment');

describe('canonical definition materialization', () => {
  it('reuses unchanged bundle bytes but detects edits, new files, removals and links', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-digest-reuse-'));
    const file = path.join(root, 'source.txt');
    fs.writeFileSync(file, 'before');
    const reads = spyOn(fs, 'readFileSync');
    try {
      const first = computeFlowBundleDigest(root);
      const count = reads.mock.calls.length;
      expect(computeFlowBundleDigest(root)).toBe(first);
      expect(reads.mock.calls.length).toBe(count);
      const times = fs.statSync(file);
      fs.writeFileSync(file, 'after!');
      fs.utimesSync(file, times.atime, times.mtime);
      const edited = computeFlowBundleDigest(root);
      expect(edited).not.toBe(first);
      fs.writeFileSync(path.join(root, 'new.txt'), 'new');
      expect(computeFlowBundleDigest(root)).not.toBe(edited);
      fs.unlinkSync(path.join(root, 'new.txt'));
      expect(computeFlowBundleDigest(root)).toBe(edited);
      fs.symlinkSync(file, path.join(root, 'link'));
      expect(() => computeFlowBundleDigest(root)).toThrow();
    } finally { reads.mockRestore(); fs.rmSync(root, {recursive: true, force: true}); }
  });
  it('keeps a linked instances boundary outside the materializer owner root unchanged', () => {
    const supportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-boundary-'));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-external-'));
    const marker = path.join(external, 'marker.txt');
    fs.writeFileSync(marker, 'unchanged');
    fs.symlinkSync(external, path.join(supportRoot, 'instances'));

    expect(() => materializeFlowInstance({
      definitionDir: definition(),
      instancesDir: path.join(supportRoot, 'instances'),
      instanceId: 'linked-instance',
      source: {
        revision: 'R1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/order-fulfillment' },
      },
    })).toThrow();
    expect(fs.readFileSync(marker, 'utf8')).toBe('unchanged');
    expect(fs.readdirSync(external)).toEqual(['marker.txt']);
  });

  it('normalizes the instance descriptor as exact closed immutable data', () => {
    const descriptor = normalizeFlowInstanceDescriptor({
      schemaVersion: 'depa.flow-instance/v1',
      instanceId: 'instance-1',
      definition: {
        revision: 'R1',
        digest: `sha256:${'a'.repeat(64)}`,
        provenance: {
          authority: 'resource-package',
          artifactRef: 'resource://flow/one',
          metadata: { channel: 'stable' },
        },
      },
      materializedAtMs: 1,
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.definition.provenance.metadata)).toBe(true);

    const extra = { ...descriptor, extra: true };
    expect(() => normalizeFlowInstanceDescriptor(extra)).toThrow();
    expect(() => normalizeFlowInstanceDescriptor({
      ...descriptor,
      definition: {
        ...descriptor.definition,
        provenance: { ...descriptor.definition.provenance, authority: '' },
      },
    })).toThrow();

    const accessor = { ...descriptor } as Record<string, unknown>;
    Object.defineProperty(accessor, 'instanceId', { enumerable: true, get: () => 'instance-1' });
    expect(() => normalizeFlowInstanceDescriptor(accessor)).toThrow();
    const symbol = { ...descriptor, [Symbol('field')]: 'value' };
    expect(() => normalizeFlowInstanceDescriptor(symbol)).toThrow();
  });

  it('rejects malformed source identity before creating an admission candidate', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-source-boundary-'));
    const instancesDir = path.join(root, 'instances');
    const base = {
      definitionDir: definition(),
      instancesDir,
      instanceId: 'closed-source',
    } as const;
    const invalidSources: unknown[] = [
      { revision: 'R1', provenance: { authority: '', artifactRef: 'resource://flow/one' } },
      { revision: 'R1', provenance: { authority: 'resource-package', artifactRef: 'resource://flow/one', extra: true } },
      { revision: 'R1', provenance: { authority: 'resource-package', artifactRef: 'resource://flow/one' }, extra: true },
      { revision: 'R1', provenance: { authority: 'resource-package', artifactRef: 'resource://flow/one', metadata: { count: Number.NaN } } },
      { revision: 'R1', provenance: { authority: 'resource-package', artifactRef: 'resource://flow/one', metadata: { values: Array(1) } } },
    ];
    const accessor = { revision: 'R1', provenance: {} } as Record<string, unknown>;
    Object.defineProperty(accessor.provenance as object, 'authority', { enumerable: true, get: () => 'resource-package' });
    Object.defineProperty(accessor.provenance as object, 'artifactRef', { enumerable: true, value: 'resource://flow/one' });
    invalidSources.push(accessor, {
      revision: 'R1',
      provenance: { authority: 'resource-package', artifactRef: 'resource://flow/one', [Symbol('field')]: true },
    });

    for (const source of invalidSources) {
      expect(() => materializeFlowInstance({
        ...base,
        source: source as never,
      })).toThrow();
      expect(fs.existsSync(instancesDir)).toBe(false);
    }
  });

  it('rejects descriptor fields outside the exact persisted contract', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-descriptor-boundary-'));
    const admitted = materializeFlowInstance({
      definitionDir: definition(),
      instancesDir: path.join(root, 'instances'),
      instanceId: 'descriptor-instance',
      source: {
        revision: 'R1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/order-fulfillment' },
      },
    });
    const descriptorFile = path.join(admitted.instanceDir, 'instance.json');
    const persisted = JSON.parse(fs.readFileSync(descriptorFile, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(descriptorFile, `${JSON.stringify({ ...persisted, extra: true }, null, 2)}\n`);
    expect(() => readFlowInstanceDescriptor(admitted.instanceDir)).toThrow();
    expect(() => loadMaterializedFlowInstance(admitted.instanceDir, 'descriptor-instance')).toThrow();
  });

  it('fails closed when an existing instance is requested with a different source identity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-identity-'));
    const source = path.join(root, 'definition');
    fs.cpSync(definition(), source, { recursive: true });
    const digest = computeFlowBundleDigest(source);
    const base = {
      definitionDir: source,
      instancesDir: path.join(root, 'instances'),
      instanceId: 'bound-instance',
      source: {
        revision: 'R1',
        expectedDigest: digest,
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/order-fulfillment' },
      },
    } as const;
    materializeFlowInstance(base);

    expect(() => materializeFlowInstance({
      ...base,
      source: { ...base.source, revision: 'R2' },
    })).toThrow();
    expect(() => materializeFlowInstance({
      ...base,
      source: {
        ...base.source,
        provenance: { ...base.source.provenance, artifactRef: 'resource://flow/other' },
      },
    })).toThrow();

    fs.writeFileSync(path.join(source, 'additional.txt'), 'new definition bytes\n');
    expect(() => materializeFlowInstance({
      ...base,
      source: { ...base.source, expectedDigest: computeFlowBundleDigest(source) },
    })).toThrow();
  });

  it('freezes the product-root statements and referenced code without legacy tree/action registries', () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-')), 'instance');
    materializeInstance(definition(), target);
    const files = fs.readdirSync(target);
    expect(files).toContain('manifest.xnl');
    expect(files).toContain('actions');
    expect(files).not.toContain('tree.xnl');
    expect(files).not.toContain('action.types.xnl');
    expect(fs.readFileSync(path.join(target, 'manifest.xnl'), 'utf8')).toContain('<WorkCtrlFlow');
  });

  it('keeps an existing instance isolated from later definition edits', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-'));
    const mutableDefinition = path.join(root, 'definition');
    fs.cpSync(definition(), mutableDefinition, { recursive: true });
    const admitted = materializeFlowInstance({
      definitionDir: mutableDefinition,
      instancesDir: path.join(root, 'instances'),
      instanceId: 'modular-instance',
      source: {
        revision: 'R1',
        provenance: { authority: 'resource-package', artifactRef: 'resource://flow/order-fulfillment' },
      },
    });
    const instance = admitted.definitionDir;
    const relativeStep = path.join('steps', 'cool-down', 'step.xnl');
    const frozen = fs.readFileSync(path.join(instance, relativeStep), 'utf8');
    fs.writeFileSync(path.join(mutableDefinition, relativeStep), frozen.replace('60000', '90000'));
    fs.rmSync(path.join(mutableDefinition, 'steps', 'pack', 'step.xnl'));
    expect(fs.readFileSync(path.join(instance, relativeStep), 'utf8')).toBe(frozen);
    expect(fs.readFileSync(path.join(mutableDefinition, relativeStep), 'utf8')).not.toBe(frozen);
    expect(fs.existsSync(path.join(instance, 'steps', 'pack', 'step.xnl'))).toBe(true);
    const fresh = loadMaterializedFlowInstance(admitted.instanceDir, 'modular-instance');
    expect(fresh.definitionDir).toBe(instance);
    expect(loadFlowBundle(fresh.definitionDir).spec?.definitionStepForest?.stepOrder).toEqual([
      'reserve-inventory', 'pack', 'cool-down', 'complete-fulfillment', 'fulfilled',
    ]);
  });

  it('writes execution annotations to the canonical product root and statement ids', () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-')), 'instance');
    materializeInstance(definition(), target);

    annotateFlowFile(target, {
      runStatus: 'Waiting',
      tickNo: 2,
      nodes: {
        pack: { status: 'Waiting' },
        'cool-down': { status: 'Init' },
      },
    });

    const manifest = fs.readFileSync(path.join(target, 'manifest.xnl'), 'utf8');
    expect(manifest).toContain('<WorkCtrlFlow #depa.flows.demo.OrderFulfillment');
    expect(manifest).toContain('runStatus = "Waiting" tickNo = 2');
    expect(fs.readFileSync(path.join(target, 'steps', 'pack', 'step.xnl'), 'utf8'))
      .toContain('<ExternalJob #pack { status = "Waiting"');
    expect(fs.readFileSync(path.join(target, 'steps', 'cool-down', 'step.xnl'), 'utf8'))
      .toContain('<Timer #cool-down { status = "Init"');
  });
});
