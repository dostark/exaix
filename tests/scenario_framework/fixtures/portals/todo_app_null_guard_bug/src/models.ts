/**
 * @module TodoAppModels
 * @path src/models.ts
 * @description swe_tasks fixture portal: shared domain types for the todo-app fixture.
 */

export type Priority = "low" | "medium" | "high";

export interface IUser {
  id: string;
  name: string;
  email: string;
}

export interface ITask {
  id: string;
  title: string;
  priority: Priority;
  done: boolean;
  dueDate: string | null;
  assignee: IUser | null;
}
