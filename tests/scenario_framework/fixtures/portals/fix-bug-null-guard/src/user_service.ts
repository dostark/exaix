/**
 * @module FixBugNullGuardFixtures
 * @path tests/scenario_framework/fixtures/portals/fix-bug-null-guard/src/user_service.ts
 * @description Fixture portal: TypeScript service with null-safety bugs.
 */

export interface IUser {
  id: number;
  name: string;
  email?: string;
}

export function formatUserName(user: IUser | null): string {
  return user.name.toUpperCase();
}

export function sendWelcomeEmail(user: IUser): boolean {
  if (!user.email) return false;
  console.log(`Sending welcome to ${user.name}`);
  return true;
}
