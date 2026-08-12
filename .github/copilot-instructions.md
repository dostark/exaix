**For all AI coding agents:**

Read and follow the guidelines in `.copilot/README.md`. Use it as the authoritative source for agent instructions in this project.

For commit message composition guidance, consult `.copilot/prompts/commit.prompt.md` and `Blueprints/Skills/commit-message.skill.md`.

- Use minimal targeted fixes.
- Prefer fixing source behavior over weakening tests.
- Do not rewrite unrelated modules.
- Keep TypeScript changes idiomatic and small.
- Run narrow tests first, then broader validation.
- Preserve public APIs unless the issue explicitly requires API change.
- Avoid introducing new dependencies unless necessary.
- When CI fails, explain the root cause in plain language.
- Do not edit tests just to make them pass unless the test is clearly wrong.
