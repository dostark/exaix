/**
 * @module RequestManagerArchivedTest
 * @path apps/tui/tests/request_manager_archived_test.ts
 * @related-files []
 * @architectural-layer TUI
 * @description Verifies the RequestManagerView TUI component's ability to toggle and display archived requests.
 */
import { assertEquals } from "@std/assert";
import type { AnalysisMode, IRequestOptions } from "@exaix/core/types";
import type { IRequestService } from "@exaix/core/types";
import { RequestManagerTuiSession } from "../src/request_manager_view.ts";
import { RequestPriority, RequestSource } from "@exaix/core";
import type { IRequest, IRequestAnalysis } from "@exaix/core/request";
import { RequestStatus, type RequestStatusType } from "@exaix/core/status";

class MockRequestService implements IRequestService {
  public listCalledWithIncludeArchived = false;

  list(_status?: RequestStatusType, includeArchived?: boolean): Promise<IRequest[]> {
    this.listCalledWithIncludeArchived = !!includeArchived;
    const requests: IRequest[] = [
      {
        trace_id: "trace1",
        filename: "req1.md",
        subject: "Request 1",
        status: RequestStatus.PENDING,
        priority: RequestPriority.NORMAL,
        identity: "agent1",
        created: new Date().toISOString(),
        created_by: "user1",
        source: RequestSource.CLI,
      },
    ];
    if (includeArchived) {
      requests.push({
        trace_id: "trace2",
        filename: "req2.md",
        subject: "Archived Request",
        status: RequestStatus.COMPLETED,
        priority: RequestPriority.LOW,
        identity: "agent1",
        created: new Date().toISOString(),
        created_by: "user1",
        source: RequestSource.CLI,
      });
    }
    return Promise.resolve(requests);
  }

  listRequests(status?: RequestStatusType, includeArchived?: boolean): Promise<IRequest[]> {
    return this.list(status, includeArchived);
  }

  show(id: string): Promise<{ metadata: IRequest; content: string }> {
    const requests: IRequest[] = [
      {
        trace_id: "trace1",
        filename: "req1.md",
        subject: "Request 1",
        status: RequestStatus.PENDING,
        priority: RequestPriority.NORMAL,
        identity: "agent1",
        created: new Date().toISOString(),
        created_by: "user1",
        source: RequestSource.CLI,
      },
      {
        trace_id: "trace2",
        filename: "req2.md",
        subject: "Archived Request",
        status: RequestStatus.COMPLETED,
        priority: RequestPriority.LOW,
        identity: "agent1",
        created: new Date().toISOString(),
        created_by: "user1",
        source: RequestSource.CLI,
      },
    ];
    const request = requests.find((r) => r.trace_id === id) || requests[0];
    return Promise.resolve({ metadata: request, content: "content" });
  }

  create(description: string, options?: IRequestOptions): Promise<IRequest> {
    return Promise.resolve({
      trace_id: "new-trace",
      filename: "new-req.md",
      subject: description,
      status: RequestStatus.PENDING,
      priority: options?.priority || RequestPriority.NORMAL,
      identity: options?.identity || "default",
      created: new Date().toISOString(),
      created_by: "user1",
      source: RequestSource.CLI,
    });
  }

  createRequest(description: string, options?: IRequestOptions): Promise<IRequest> {
    return this.create(description, options);
  }

  getRequestContent(_requestId: string): Promise<string> {
    return Promise.resolve("content");
  }

  updateRequestStatus(_requestId: string, _status: RequestStatusType): Promise<boolean> {
    return Promise.resolve(true);
  }

  getAnalysis(_requestId: string): Promise<IRequestAnalysis | null> {
    return Promise.resolve(null);
  }

  analyze(_requestId: string, _options?: { mode?: AnalysisMode; force?: boolean }): Promise<IRequestAnalysis> {
    return Promise.reject(new Error("Not implemented in mock"));
  }
}

Deno.test("RequestManagerTuiSession - toggle show archived", async () => {
  const service = new MockRequestService();
  const initialRequests = await service.listRequests();
  const session = new RequestManagerTuiSession(initialRequests, service);

  assertEquals(session.getState().showArchived, false);
  assertEquals(service.listCalledWithIncludeArchived, false);

  // Toggle archived
  await session.toggleShowArchived();

  assertEquals(session.getState().showArchived, true);
  assertEquals(service.listCalledWithIncludeArchived, true);
  assertEquals(session.getRequests().length, 2);

  // Toggle back
  await session.toggleShowArchived();

  assertEquals(session.getState().showArchived, false);
  assertEquals(service.listCalledWithIncludeArchived, false);
  assertEquals(session.getRequests().length, 1);
});
