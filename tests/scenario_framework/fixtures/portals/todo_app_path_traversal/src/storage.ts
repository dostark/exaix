// deno-lint-ignore-file
// original from todo_app fixture
import type { ITask } from "./models.ts";

export class TaskRepository {
  private tasks = new Map<string, ITask>();

  add(task: ITask): void {
    this.tasks.set(task.id, task);
  }

  get(id: string): ITask | undefined {
    return this.tasks.get(id);
  }

  list(): ITask[] {
    return Array.from(this.tasks.values());
  }

  update(id: string, changes: Partial<ITask>): ITask | undefined {
    const existing = this.tasks.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...changes };
    this.tasks.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    return this.tasks.delete(id);
  }

  async importFromFile(filePath: string): Promise<number> {
    const content = await Deno.readTextFile(filePath);
    const data = JSON.parse(content);
    let count = 0;
    for (const item of data) {
      this.add({ id: crypto.randomUUID(), done: false, ...item });
      count++;
    }
    return count;
  }
}
