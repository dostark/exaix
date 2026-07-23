# Fix path traversal in importFromFile

The `importFromFile` method in `src/storage.ts` reads any file path provided
by the caller without validation, allowing path traversal attacks (e.g.
reading `/etc/passwd`).

Files: src/storage.ts

Actions:

1. Read src/storage.ts to understand the importFromFile method
2. Add path validation to reject files outside the allowed directory
3. Run `deno test src/storage_test.ts` to verify

Constraints:

- Must use a portable path check (no Deno.cwd assumptions)
- Existing repository methods must remain unchanged
