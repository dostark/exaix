# Map the dependency graph of the storage module

Create a markdown document (`docs/dependency-map.md`) that maps the
dependency graph of the `src/storage.ts` module.

The document must describe:

1. All direct imports of `src/storage.ts` from other modules
2. The types `src/storage.ts` depends on (from `src/models.ts`)
3. Which modules depend on `TaskRepository`
4. Draw a simple ASCII dependency graph

Files: docs/dependency-map.md

Actions:

1. Read all source files in `src/` to trace imports
2. Identify every module that imports from `storage.ts`
3. Identify every type `storage.ts` uses from `models.ts`
4. Create docs/dependency-map.md with the dependency graph

Constraints:

- The document must list `TaskRepository` as the main export
- The document must mention `ITask` as a dependency
- Include an ASCII or mermaid-style graph
