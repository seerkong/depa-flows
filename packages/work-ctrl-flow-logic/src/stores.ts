/**
 * WorkCtrlFlowStore 实现：文件系统打底 + 内存（测试）。单写者假设（design A1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WorkCtrlFlowSnapshot, WorkCtrlFlowStore } from 'work-ctrl-flow-contract';

export class InMemoryWorkCtrlFlowStore implements WorkCtrlFlowStore {
  private snapshots = new Map<string, WorkCtrlFlowSnapshot>();

  async load(treeId: string): Promise<WorkCtrlFlowSnapshot | undefined> {
    const s = this.snapshots.get(treeId);
    return s ? structuredClone(s) : undefined;
  }
  async save(snapshot: WorkCtrlFlowSnapshot): Promise<void> {
    this.snapshots.set(snapshot.treeId, structuredClone(snapshot));
  }
  async remove(treeId: string): Promise<void> {
    this.snapshots.delete(treeId);
  }
}

export class FileWorkCtrlFlowStore implements WorkCtrlFlowStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(treeId: string) {
    return path.join(this.dir, `${encodeURIComponent(treeId)}.snapshot.json`);
  }
  async load(treeId: string): Promise<WorkCtrlFlowSnapshot | undefined> {
    const f = this.file(treeId);
    if (!fs.existsSync(f)) return undefined;
    return JSON.parse(fs.readFileSync(f, 'utf8')) as WorkCtrlFlowSnapshot;
  }
  async save(snapshot: WorkCtrlFlowSnapshot): Promise<void> {
    const f = this.file(snapshot.treeId);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, f);
  }
  async remove(treeId: string): Promise<void> {
    fs.rmSync(this.file(treeId), { force: true });
  }
}
