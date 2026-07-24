/**
 * @module TaskStorage
 * @description In-memory task repository with CRUD operations.
 * Stores tasks in a Map keyed by task ID.
 */

export class TaskRepository {
  /**
   * Creates a task repository with an optional initial task list.
   * @param initialTasks - Optional starting tasks to populate the store.
   */
  constructor(initialTasks?: ITask[]);

  /**
   * Adds a new task to the repository.
   * @param task - The task to add (must have a unique id).
   */
  add(task: ITask): void;

  /**
   * Retrieves a task by ID.
   * @param id - The task's unique identifier.
   * @returns The task if found, or undefined if no task matches the id.
   */
  get(id: string): ITask | undefined;

  /**
   * Returns all stored tasks as an array.
   * @returns A shallow copy of the internal tasks array.
   */
  list(): ITask[];

  /**
   * Merges partial changes into an existing task.
   * @param id - The target task's unique identifier.
   * @param changes - Partial task fields to merge.
   * @returns The updated task if found, or undefined if the id does not exist.
   */
  update(id: string, changes: Partial<ITask>): ITask | undefined;

  /**
   * Removes a task by ID.
   * @param id - The task's unique identifier.
   * @returns True if the task was found and removed, false otherwise.
   */
  remove(id: string): boolean;

  /**
   * Maximum number of tasks allowed (configurable).
   */
  static readonly DEFAULT_MAX_TASKS: number;
}
