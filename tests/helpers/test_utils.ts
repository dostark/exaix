/**
 * @module GlobalTestUtils
 * @path tests/helpers/test_utils.ts
 * @description Provides general-purpose utilities for the test suite, including
 * wait-based synchronization, temporary file cleanup, and process capturing.
 */

import { MemoryBankSource, RequestSource, SkillStatus } from "@exaix/core";
import { PlanStatus, type PlanStatusType } from "@exaix/core/status";
import { RequestStatus, type RequestStatusType } from "@exaix/core/status";
import type { Opt, Reason } from "@exaix/core/types";

// Test Data Factories

export interface ITestRequestFixture {
  trace_id: string;
  filename: string;
  subject: string;
  status: RequestStatusType;
  priority: string;
  identity: string;
  portal?: string;
  model?: string;
  created: string;
  created_by: string;
  source: string;
}

export interface ITestPlanFixture {
  id: string;
  subject: string;
  status: PlanStatusType;
  rejectionReason?: string;
}

export interface ITestSkillFixture {
  id: string;
  name: string;
  version: string;
  status: SkillStatus;
  source: MemoryBankSource;
  description: string;
}

/** Generic test data factory that creates objects with default values and overrides. */
export class TestDataFactory<T> {
  private readonly defaultsFactory: () => T;

  constructor(defaults: T | (() => T)) {
    this.defaultsFactory = typeof defaults === "function" ? (defaults as () => T) : () => ({ ...defaults });
  }

  create(overrides: Partial<T> = {}): T {
    return { ...this.defaultsFactory(), ...overrides };
  }

  createMany(count: number, overrides: Partial<T>[] = []): T[] {
    return Array.from({ length: count }, (_, i) => this.create(overrides[i] || {}));
  }
}

// Request factory
export const requestFactory = new TestDataFactory<ITestRequestFixture>(() => ({
  trace_id: `req-${Math.floor(Math.random() * 1e6)}`,
  filename: "request.md",
  subject: "Request",
  status: RequestStatus.PENDING,
  priority: "normal",
  identity: "default",
  created: new Date().toISOString(),
  created_by: "test@example.com",
  source: RequestSource.CLI,
}));

// Plan factory
export const planFactory = new TestDataFactory<ITestPlanFixture>(() => ({
  id: `plan-${Math.floor(Math.random() * 1e6)}`,
  subject: "Plan",
  status: PlanStatus.REVIEW,
}));

// Skill factory
export const skillFactory = new TestDataFactory<ITestSkillFixture>(() => ({
  id: `skill-${Math.floor(Math.random() * 1e6)}`,
  name: "Skill",
  version: "1.0.0",
  status: SkillStatus.ACTIVE,
  source: MemoryBankSource.CORE,
  description: "Test skill",
}));

// Mock Service Base Classes

/**
 * Base class for mock services with common CRUD operations
 */
export abstract class BaseMockService<T extends { id?: string; trace_id?: string }> {
  protected items: T[] = [];

  constructor(initialItems: T[] = []) {
    this.items = [...initialItems];
  }

  list(): Promise<T[]> {
    return Promise.resolve([...this.items]);
  }

  get(id: string): Promise<T | null> {
    const item = this.items.find((item) => item.id === id || item.trace_id === id);
    return Promise.resolve(item || null);
  }

  create(item: Omit<T, "id"> & { id?: string }): Promise<T> {
    const newItem = {
      ...item,
      id: item.id || `item-${Date.now()}-${Math.random()}`,
    } as T;
    this.items.push(newItem);
    return Promise.resolve(newItem);
  }

  update(id: string, updates: Partial<T>): Promise<boolean> {
    const index = this.items.findIndex((item) => item.id === id || item.trace_id === id);
    if (index === -1) return Promise.resolve(false);

    this.items[index] = { ...this.items[index], ...updates };
    return Promise.resolve(true);
  }

  delete(id: string): Promise<boolean> {
    const index = this.items.findIndex((item) => item.id === id || item.trace_id === id);
    if (index === -1) return Promise.resolve(false);

    this.items.splice(index, 1);
    return Promise.resolve(true);
  }
}

/**
 * Mock service for requests with common operations
 */
export class MockRequestService extends BaseMockService<ITestRequestFixture> {
  constructor(initialRequests: ITestRequestFixture[] = []) {
    super(initialRequests);
  }

  listRequests(status?: Opt<RequestStatusType, Reason.QueryFilter>): Promise<ITestRequestFixture[]> {
    if (status) {
      return Promise.resolve(this.items.filter((r) => r.status === status));
    }
    return this.list();
  }

  getRequestContent(id: string): Promise<string> {
    const request = this.items.find((r) => r.trace_id === id);
    return Promise.resolve(request ? `Content for ${id}` : "");
  }

  createRequest(
    description: string,
    options?: Opt<{ priority?: string; identity?: string; portal?: string; model?: string }, Reason.TestOverride>,
  ): Promise<ITestRequestFixture> {
    return this.create({
      trace_id: `test-${Date.now()}`,
      filename: `request-test.md`,
      subject: description,
      status: RequestStatus.PENDING,
      priority: options?.priority || "normal",
      identity: options?.identity || "default",
      portal: options?.portal,
      model: options?.model,
      created: new Date().toISOString(),
      created_by: "test@example.com",
      source: RequestSource.CLI,
    });
  }

  updateRequestStatus(id: string, status: RequestStatusType): Promise<boolean> {
    return this.update(id, { status });
  }
}

/**
 * Mock service for plans with common operations
 */
export class MockPlanService extends BaseMockService<ITestPlanFixture> {
  constructor(initialPlans: ITestPlanFixture[] = []) {
    super(initialPlans);
  }

  getPlanContent(id: string): Promise<string> {
    const plan = this.items.find((p) => p.id === id);
    return Promise.resolve(plan ? `Content for plan ${id}` : "");
  }

  approvePlan(id: string): Promise<boolean> {
    return this.update(id, { status: PlanStatus.APPROVED });
  }

  rejectPlan(id: string, reason?: Opt<string, Reason.OptionalInput>): Promise<boolean> {
    const updateData: Partial<ITestPlanFixture> = { status: PlanStatus.REJECTED };
    if (reason !== undefined) {
      updateData.rejectionReason = reason;
    }
    return this.update(id, updateData);
  }
}

// Common Test Data Sets

export const commonTestData = {
  requests: {
    basic: () =>
      requestFactory.createMany(2, [
        { trace_id: "req-1" },
        { trace_id: "req-2", subject: "Request 2", status: RequestStatus.PLANNED },
      ]),
    two: () =>
      requestFactory.createMany(2, [
        { trace_id: "req-1" },
        { trace_id: "req-2", subject: "Request 2" },
      ]),

    grouped: () =>
      requestFactory.createMany(2, [
        {},
        {
          trace_id: "req-2",
          subject: "Request 2",
          status: RequestStatus.PLANNED,
          identity: "other",
        },
      ]),
    pending: () =>
      requestFactory.createMany(2, [
        { status: RequestStatus.PENDING },
        { status: RequestStatus.PENDING, trace_id: "req-2", subject: "Request 2" },
      ]),
  },

  plans: {
    basic: () => planFactory.createMany(3),
    single: () => planFactory.createMany(1),
    withStatuses: () =>
      planFactory.createMany(3, [
        { id: "p1", subject: "Plan 1", status: PlanStatus.REVIEW },
        { id: "p2", subject: "Plan 2", status: PlanStatus.APPROVED },
        { id: "p3", subject: "Plan 3", status: PlanStatus.REJECTED },
      ]),
    pending: () =>
      planFactory.createMany(2, [
        { status: PlanStatus.REVIEW },
        { status: PlanStatus.REVIEW, id: "p2", subject: "Plan 2" },
      ]),
  },

  skills: {
    basic: () => skillFactory.createMany(3),
    single: () => skillFactory.createMany(1),
    withStatuses: () =>
      skillFactory.createMany(3, [
        { status: SkillStatus.ACTIVE },
        { status: SkillStatus.DRAFT },
        { status: SkillStatus.DEPRECATED },
      ]),
  },

  // Standard mock objects
  mockObjects: {
    newRequest: (): ITestRequestFixture => ({
      trace_id: "new-req",
      filename: "request-new.md",
      subject: "New Request",
      status: RequestStatus.PENDING,
      priority: "normal",
      identity: "default",
      created: new Date().toISOString(),
      created_by: "test@example.com",
      source: "tui",
    }),
  },
};

// Utility Functions

/**
 * Creates a standard test scenario with service, view, and TUI session
 */
export function createTestScenario<T extends { id?: string; trace_id?: string }, V>(
  ServiceClass: new (items: T[]) => T,
  ViewClass: new (service: T) => V,
  data: T[] = [],
): { service: T; view: V } {
  const service = new ServiceClass(data);
  const view = new ViewClass(service);
  return { service, view };
}

/**
 * Creates a TUI session for testing
 */
export function createTuiSession<T>(view: { createTuiSession: (data?: string[]) => T }, data: string[] = []): T {
  return view.createTuiSession(data);
}
