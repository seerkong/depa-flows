/**
 * WorkFlowStore 实现：文件系统打底 + 内存（测试）。单写者假设（design A1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WorkFlowSnapshot, WorkFlowStore } from 'work-flow-contract';

export class InMemoryWorkFlowStore implements WorkFlowStore {
  private snapshots = new Map<string, WorkFlowSnapshot>();

  async load(treeId: string): Promise<WorkFlowSnapshot | undefined> {
    const s = this.snapshots.get(treeId);
    return s ? structuredClone(s) : undefined;
  }
  async save(snapshot: WorkFlowSnapshot): Promise<void> {
    this.snapshots.set(snapshot.treeId, structuredClone(snapshot));
  }
  async remove(treeId: string): Promise<void> {
    this.snapshots.delete(treeId);
  }
}

export class FileWorkFlowStore implements WorkFlowStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(treeId: string) {
    return path.join(this.dir, `${encodeURIComponent(treeId)}.snapshot.json`);
  }
  async load(treeId: string): Promise<WorkFlowSnapshot | undefined> {
    const f = this.file(treeId);
    if (!fs.existsSync(f)) return undefined;
    return JSON.parse(fs.readFileSync(f, 'utf8')) as WorkFlowSnapshot;
  }
  async save(snapshot: WorkFlowSnapshot): Promise<void> {
    const f = this.file(snapshot.treeId);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, f);
  }
  async remove(treeId: string): Promise<void> {
    fs.rmSync(this.file(treeId), { force: true });
  }
}
