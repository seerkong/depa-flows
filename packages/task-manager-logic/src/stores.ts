/**
 * 任务树外置存储：内存 + 文件（JSON）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { TaskSpaceDTO, TaskSpaceStore } from 'task-manager-contract';

export class InMemoryTaskSpaceStore implements TaskSpaceStore {
  private spaces = new Map<string, TaskSpaceDTO>();
  async load(spaceId: string): Promise<TaskSpaceDTO | undefined> {
    const s = this.spaces.get(spaceId);
    return s ? structuredClone(s) : undefined;
  }
  async save(spaceId: string, space: TaskSpaceDTO): Promise<void> {
    this.spaces.set(spaceId, structuredClone(space));
  }
  async remove(spaceId: string): Promise<void> {
    this.spaces.delete(spaceId);
  }
}

export class FileTaskSpaceStore implements TaskSpaceStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }
  private file(spaceId: string) {
    return path.join(this.dir, `${encodeURIComponent(spaceId)}.task-space.json`);
  }
  async load(spaceId: string): Promise<TaskSpaceDTO | undefined> {
    const f = this.file(spaceId);
    if (!fs.existsSync(f)) return undefined;
    return JSON.parse(fs.readFileSync(f, 'utf8')) as TaskSpaceDTO;
  }
  async save(spaceId: string, space: TaskSpaceDTO): Promise<void> {
    const f = this.file(spaceId);
    fs.writeFileSync(f + '.tmp', JSON.stringify(space, null, 2));
    fs.renameSync(f + '.tmp', f);
  }
  async remove(spaceId: string): Promise<void> {
    fs.rmSync(this.file(spaceId), { force: true });
  }
}
