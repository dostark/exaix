# Live Codex cache-token fixture

`exec.jsonl` is verbatim stdout from Codex CLI 0.153.4 on September 17, 2026,
using the existing subscription login and model `gpt-5.6-sol`. It was captured
by a transparent binary wrapper around the real subprocess launched by
`CliDelegateModelProvider.generate`, using the daemon's wrapper order:
`RateLimitedProvider(TracedProvider(CliDelegateModelProvider))`.

Invocation:

```sh
codex exec --json --model gpt-5.6-sol --sandbox read-only --skip-git-repo-check \
  'Reply with exactly the word: pong'
```

The live call reported 23,239 input tokens, 11,136 cached input tokens, five
output tokens and zero reasoning tokens. The dedicated SQLite
`activity.cache_read_tokens` and `provider_costs.cache_read_tokens` columns
both contained 11,136. The production `exactl cost` handler rendered
`11136/-` and `Total Cache Tokens: Read: 11136, Creation: 0`.

A preceding direct `codex exec --json` call reported 24,392 input tokens and
12,160 cached input tokens. No cache-read field or nesting drift was found
in either captured turn. The real CLI additionally emits
`cache_write_input_tokens: 0`; this fixture retains it, while Exaix preserves
Codex's absent cache-creation contract: undefined provider/cost-record values
and NULL dedicated database columns. The journal payload and aggregate cost
report normalize absent creation to zero for display.

The integration test replays this file only at the subprocess boundary. Parsing,
provider wrappers, EventLogger, DatabaseService, CostTracker and cost rendering
all execute production code. Refresh the fixture with a real invocation;
do not replace its usage object with synthesized events.
