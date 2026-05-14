# Package migration plan

This document is the root-repo pointer for the active package-migration backlog.

The detailed tracker lives in the dev-docs submodule:

- [exaix-dev-docs/planning/phase-76-package-migration.md](../../exaix-dev-docs/planning/phase-76-package-migration.md)

## Current workspace shape

The root Deno workspace currently declares these packages:

- `@exaix/schemas`
- `@exaix/parsing`
- `@exaix/core`
- `@exaix/ai`
- `@exaix/tui`
- `@exaix/mcp`
- `@exaix/git`
- `@exaix/cli`
- `@exaix/testing`
- `@exaix/memory`

## Current status summary

- `@exaix/schemas` and `@exaix/parsing` are the completed extraction milestones.
- `@exaix/core`, `@exaix/ai`, `@exaix/tui`, `@exaix/cli`, and `@exaix/mcp` are partially migrated.
- `@exaix/testing` contains shared helpers used by package-local tests.
- `@exaix/memory` is still scaffold-only.
- `@exaix/git` exists in the workspace and should be tracked explicitly in the backlog.

## Working rule

When the root repo and the detailed backlog diverge, update the submodule tracker first, then update root-repo pointers and package-structure references.
