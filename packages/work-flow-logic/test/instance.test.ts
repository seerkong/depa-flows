import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { annotateFlowFile, materializeInstance } from '../src/instance.js';

const ROOT = path.resolve(import.meta.dir, '../../..');
const definition = () => path.join(ROOT, 'examples/xnl-bundles/order-fulfillment');

describe('canonical definition materialization', () => {
  it('freezes the product-root statements and referenced code without legacy tree/action registries', () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-')), 'instance');
    materializeInstance(definition(), target);
    const files = fs.readdirSync(target);
    expect(files).toContain('manifest.xnl');
    expect(files).toContain('actions');
    expect(files).not.toContain('tree.xnl');
    expect(files).not.toContain('action.types.xnl');
    expect(fs.readFileSync(path.join(target, 'manifest.xnl'), 'utf8')).toContain('<WorkFlow');
  });

  it('keeps an existing instance isolated from later definition edits', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-instance-'));
    const mutableDefinition = path.join(root, 'definition');
    const instance = path.join(root, 'instance');
    fs.cpSync(definition(), mutableDefinition, { recursive: true });
    materializeInstance(mutableDefinition, instance);
    const frozen = fs.readFileSync(path.join(instance, 'manifest.xnl'), 'utf8');
    fs.writeFileSync(path.join(mutableDefinition, 'manifest.xnl'), frozen.replace('<Timer #cool-down { durationMs = 60000 }>', ''));
    expect(fs.readFileSync(path.join(instance, 'manifest.xnl'), 'utf8')).toBe(frozen);
    expect(fs.readFileSync(path.join(mutableDefinition, 'manifest.xnl'), 'utf8')).not.toBe(frozen);
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
    expect(manifest).toContain('<WorkFlow #depa.flows.demo.OrderFulfillment');
    expect(manifest).toContain('runStatus = "Waiting" tickNo = 2');
    expect(manifest).toContain('<ExternalJob #pack { status = "Waiting"');
    expect(manifest).toContain('<Timer #cool-down { status = "Init"');
  });
});
