# Explain the request-processing flow

Write a markdown document (`docs/request-flow.md`) that explains how a
request flows through the system from submission to execution.

The document must describe:

1. How a request enters the system (the `IRequest` interface in `src/api.ts`)
2. How `TaskRepository` processes it (in `src/storage.ts`)
3. How the response is returned (the `IResponse` interface)

Files: docs/request-flow.md

Actions:

1. Read src/api.ts, src/storage.ts, and src/models.ts to understand the flow
2. Create docs/request-flow.md with the explanation
3. Include at least one code example showing a full request cycle

Constraints:

- The document must mention `IRequest` and `IResponse` by name
- The document must describe the `TaskRepository` interface
- Use markdown format with appropriate headings
