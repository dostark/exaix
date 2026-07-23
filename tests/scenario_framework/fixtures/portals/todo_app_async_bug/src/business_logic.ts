// deno-lint-ignore-file
// original from todo_app fixture
import type { ITask, IUser, Priority } from "./models.ts";

export interface ITaskSubmissionResult {
  success: boolean;
  task?: ITask;
  errors: string[];
}

export function processTaskSubmission(
  title: string,
  rawPriority: string,
  dueDate: string | null,
  assignee: IUser | null,
  existingTasks: ITask[],
): ITaskSubmissionResult {
  const errors: string[] = [];

  if (!title || title.trim().length === 0) errors.push("Title is required");
  if (title.length > 200) errors.push("Title exceeds 200 characters");

  const validPriorities: Priority[] = ["low", "medium", "high"];
  let priority: Priority = "medium";
  if (rawPriority) {
    if (!validPriorities.includes(rawPriority as Priority)) {
      errors.push(`Invalid priority: ${rawPriority}`);
    } else {
      priority = rawPriority as Priority;
    }
  }

  if (dueDate !== null) {
    const parsed = new Date(dueDate);
    if (Number.isNaN(parsed.getTime())) {
      errors.push(`Invalid due date: ${dueDate}`);
    } else if (parsed.getTime() < Date.now()) {
      errors.push("Due date must be in the future");
    }
  }

  const duplicateCount = existingTasks.filter((t) => t.title === title).length;
  if (duplicateCount >= 3) {
    errors.push("Too many tasks with this title already exist");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const task: ITask = {
    id: crypto.randomUUID(),
    title,
    priority,
    done: false,
    dueDate,
    assignee,
  };

  return { success: true, task, errors: [] };
}

export async function processBatchSubmissions(
  submissions: Array<{ title: string; rawPriority: string; dueDate: string | null; assignee: IUser | null }>,
  getExistingTasks: () => Promise<ITask[]>,
  addTask: (task: ITask) => Promise<void>,
): Promise<ITaskSubmissionResult[]> {
  const results: ITaskSubmissionResult[] = [];
  const existing = [...await getExistingTasks()];

  for (const sub of submissions) {
    const result = processTaskSubmission(sub.title, sub.rawPriority, sub.dueDate, sub.assignee, existing);
    if (result.success && result.task) {
      await addTask(result.task);
    }
    results.push(result);
  }

  return results;
}
