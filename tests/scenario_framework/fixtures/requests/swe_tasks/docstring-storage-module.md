# Add JSDoc documentation to the storage module

The `src/storage.ts` module has minimal documentation. Add comprehensive
JSDoc comments to:

1. The `TaskRepository` class
2. Every public method (`add`, `get`, `list`, `update`, `remove`)
3. The `DEFAULT_MAX_TASKS` constant

Files: src/storage.ts

Actions:

1. Read src/storage.ts to understand the implementation
2. Add JSDoc comments describing each method's purpose, parameters,
   return value, and edge cases
3. Run `deno doc src/storage.ts` to verify documentation is valid

Constraints:

- Do not change any implementation code
- Each method must have `@param` and `@returns` JSDoc tags
- The class must have a `@description` tag
- The documentation must describe error cases (missing ID, etc.)
