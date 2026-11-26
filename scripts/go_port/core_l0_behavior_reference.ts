#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0BehaviorReference
 * @path scripts/go_port/core_l0_behavior_reference.ts
 * @description Builds differential cases of the kept core errors, func helpers, portal knowledge and parsing behavior for the Go reference fixtures.
 * Usage: imported by scripts/go_port/core_l0_reference.ts.
 */
import {
  ContextBudgetExceededError,
  ContextError,
  RequestCancelNotAllowedError,
  RequestIdError,
  RequestNotFoundError,
  RequestStatusInvalidError,
  SafeError,
} from "@exaix/core/errors";
import {
  appendToRequest,
  buildAdaptivePortalKnowledge,
  buildPortalContextBlock,
  containsKnownSecret,
  DEFAULT_CONTEXT_ITEM_DELIMITER,
  extractSection,
  fitContextItems,
  isReadOnlyAgentCapabilities,
  isTrustedDogfoodCaller,
  mergeAsContext,
  normalizePortalPath,
  parseCodeGeneration,
  passthrough,
  redactKnownSecrets,
  repairJSON,
  requiresGitTracking,
  sanitizePortalKnowledgeText,
  scorePortalKnowledge,
  stripTerminalControlBytes,
  templateFill,
  validateFilePath,
} from "@exaix/core/func";
import { FrontmatterParser } from "@exaix/core/parsing";
import { RequestStatus } from "@exaix/core/status";
import { type JSONValue, TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core/types";
import { ToolName } from "@exaix/core";
import { type IPortalKnowledge, PortalKnowledgeSchema } from "@exaix/schemas/portal_knowledge.ts";

interface ITemplateContext {
  [key: string]: JSONValue;
}

const SAMPLE_PORTAL_ROOT = "/tmp/portal";
const SAMPLE_MODEL = "sample-model";
const PORTAL_TOKEN_LIMIT_WIDE = 400;
const PORTAL_TOKEN_LIMIT_NARROW = 90;
const PORTAL_CORE_LIMIT_WIDE = 120;
const PORTAL_CORE_LIMIT_NARROW = 30;
const PORTAL_ENTRY_LIMIT = 20;

/** Token estimate of the character ratio fallback, in UTF-16 code units. */
function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN);
}

const SAMPLE_TOKENIZER = {
  countTokens: (text: string): Promise<number> => Promise.resolve(estimateTokens(text)),
  countTokensBatch: (texts: string[]): Promise<number[]> => Promise.resolve(texts.map(estimateTokens)),
};

function messageOf<T>(run: () => T): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

async function asyncMessageOf<T>(run: () => Promise<T>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

/** Builds the cases of the kept error kinds that carry data. */
export function buildErrorKindCases(): object {
  const cause = new Error("disk full");
  const withCause = new ContextError("write failed", { path: "a.txt", attempt: 2, retry: true, note: null }, cause);
  const withoutCause = new ContextError("plain", {});
  const safe = new SafeError("Something went wrong", "E_SAFE");
  const budget = new ContextBudgetExceededError("over budget", "model-x", 1000, 1500, { system: 400, skills: 1100 });
  const toJson = (error: ContextError) => {
    const { stack: _stack, ...rest } = error.toJSON();
    return rest;
  };
  return {
    context_error_with_cause: toJson(withCause),
    context_error_without_cause: toJson(withoutCause),
    safe_error: { json: safe.toJSON(), text: safe.toString(), message: safe.message },
    context_budget: {
      name: budget.name,
      message: budget.message,
      model: budget.model,
      context_window: budget.contextWindow,
      estimated_tokens: budget.estimatedTokens,
      section_breakdown: budget.sectionBreakdown,
    },
    request_id_error_name: new RequestIdError("x", []).name,
    request_not_found_name: new RequestNotFoundError("r").name,
    request_status_invalid_name: new RequestStatusInvalidError("r").name,
    cancel_not_allowed_name: new RequestCancelNotAllowedError("r", RequestStatus.PLANNED).name,
  };
}

function gitTrackingCases(): object[] {
  const write = ToolName.WRITE_FILE;
  const read = ToolName.READ_FILE;
  const sets: Array<[string[], string[] | undefined]> = [
    [[], undefined],
    [[read], undefined],
    [[write], undefined],
    [[read], [ToolName.GIT_COMMIT]],
    [[read], [ToolName.GIT_CREATE_BRANCH]],
    [[], [read]],
    [[], []],
  ];
  return sets.map(([capabilities, permitted]) => ({
    capabilities,
    permitted_tools: permitted ?? null,
    requires_git_tracking: requiresGitTracking(capabilities, permitted),
    read_only: isReadOnlyAgentCapabilities(capabilities, permitted),
  }));
}

async function fitContextCases(): Promise<object[]> {
  const items = ["alpha beta", "x".repeat(60), "gamma", "delta epsilon zeta", "eta"];
  const cases: { items: string[]; budget: number; delimiter: string | undefined }[] = [
    { items, budget: 0, delimiter: undefined },
    { items: [], budget: 50, delimiter: undefined },
    { items, budget: 10, delimiter: undefined },
    { items, budget: 30, delimiter: undefined },
    { items, budget: 200, delimiter: undefined },
    { items, budget: 30, delimiter: "" },
    { items, budget: 30, delimiter: " | " },
  ];
  const results: object[] = [];
  for (const tc of cases) {
    const result = await fitContextItems(SAMPLE_TOKENIZER, SAMPLE_MODEL, tc.items, tc.budget, tc.delimiter);
    results.push({
      items: tc.items,
      budget_tokens: tc.budget,
      delimiter: tc.delimiter ?? null,
      selected: result.selected,
      used_tokens: result.usedTokens,
    });
  }
  const failure = await asyncMessageOf(() => fitContextItems(SAMPLE_TOKENIZER, SAMPLE_MODEL, items, -1));
  results.push({ items, budget_tokens: -1, delimiter: null, error: failure });
  return results;
}

function redactionCases(): object {
  const privateKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
  const texts = [
    "token=abc123 and again abc123",
    `key follows ${privateKey} done`,
    "Authorization: Bearer abc.def-ghi_jkl== trailing",
    "nothing secret here",
    "two secrets s1 and s2 and s1",
  ];
  const secrets = ["abc123", "s1", "s2", ""];
  return {
    redact: texts.map((text) => ({ text, secrets, result: redactKnownSecrets(text, secrets) })),
    contains: texts.map((text) => ({ text, secrets, contains: containsKnownSecret(text, secrets) })),
    contains_empty_secret: containsKnownSecret("text", [""]),
    strip: ["a\u0000b\u001b[31mc\td\ne\u007f", "plain", "\u0008\u000b\u001f"].map((text) => ({
      text,
      stripped: stripTerminalControlBytes(text),
    })),
  };
}

function repairCases(): object[] {
  const inputs = [
    '{"a": 1}',
    '{"a": 1,}',
    '{"a": [1, 2,]}',
    "{'a': 1}",
    "{a: 1, b: 2}",
    '{"a": 1} // note',
    '{"a": /* c */ 1}',
    'Here is JSON:\n```json\n{"a": "x"}\n```',
    '{"a": "line1\nline2"}',
    "{\"a\": 'it\\'s'}",
    "no json at all",
    "  {a: 1,}  ",
    '{"url": "http://example.com/a"}',
  ];
  return inputs.map((input) => {
    // The reference global patterns keep lastIndex state. An empty call resets it, so each case is stateless.
    repairJSON("");
    return { input, ...repairJSON(input) };
  });
}

function transformCases(): object {
  const mergeInputs: string[][] = [
    [],
    ["one"],
    ["# Title\nfirst body", "second"],
    ["alpha\n## Sub\nbeta", "## Heading\ntext"],
    ["# Title\n\nfirst", "# Second\nbody"],
    ["plain\n# Mid\nline", "x"],
  ];
  const document = "# Doc\n\n## Alpha\nline a\n\n\n## Beta section\nline b\n";
  const templates: Array<[string, ITemplateContext]> = [
    ["Hello {{name}}, {{name}}!", { name: "World" }],
    ["{{a}}-{{b}}-{{c}}", { a: 1, b: true, c: null }],
    ["{{obj}} and {{list}}", { obj: { k: "v", n: [1, 2] }, list: [1, "two"] }],
    ["no placeholders", {}],
    ["{{count}} items", { count: 12.5 }],
    ["missing {{nope}}", {}],
  ];
  return {
    passthrough: passthrough("same"),
    merge: mergeInputs.map((inputs) => ({ inputs, merged: mergeAsContext(inputs) })),
    extract: ["Alpha", "Beta", "Gamma"].map((name) => {
      const error = messageOf(() => extractSection(document, name));
      return { input: document, section: name, value: error ? null : extractSection(document, name), error };
    }),
    append: [["", ""], ["req", ""], ["", "out"], ["req", "out"]].map(([request, output]) => ({
      request,
      step_output: output,
      value: appendToRequest(request, output),
    })),
    template: templates.map(([template, context]) => {
      const error = messageOf(() => templateFill(template, context));
      return {
        template,
        context,
        value: error ? null : templateFill(template, context),
        error,
      };
    }),
  };
}

function portalContextCases(): object[] {
  return [
    { portalAlias: "main", portalRoot: "/p/main" },
    { portalAlias: "main", portalRoot: "/p/main", repositoryRoot: "/repo" },
    { portalAlias: "main", portalRoot: "/p/main", fileList: "a.ts\nb.ts" },
    { portalAlias: "main", portalRoot: "/p/main", repositoryRoot: "/repo", fileList: "" },
  ].map((args) => ({ args, block: buildPortalContextBlock(args) }));
}

function codeParserCases(): object {
  const responses = [
    "no headers here",
    "### src/a.ts (create)\n```ts\nconst a = 1;\n```\n### src/b.ts (modify)\n```\nlet b;\n```",
    "### old.ts (delete)\n",
    "### /abs.ts (create)\n```\nx\n```\n### ../up.ts (create)\n```\ny\n```",
    "### dup.ts (create)\n```\n1\n```\n### dup.ts (modify)\n```\n2\n```",
    "### nocode.ts (create)\nno fence follows",
    "### c.ts (create)\n```python\nprint(1)\n```\ntrailing text",
  ];
  const paths = ["src/a.ts", "/abs", "../x", "a/../b", "..", "a/..", "./a", "a//b", "", "a/./b/../c", "..a/b"];
  return {
    portal_root: SAMPLE_PORTAL_ROOT,
    parse: responses.map((response) => ({ response, result: parseCodeGeneration(response, SAMPLE_PORTAL_ROOT) })),
    validate: ["/tmp/portal", "/tmp/portal/", "", "."].flatMap((root) =>
      paths.map((path) => ({ root, path, result: validateFilePath(path, root) }))
    ),
  };
}

function estimateCases(): object[] {
  return ["", "a", "abcd", "abcde", "héllo wörld", "😀😀😀", "x".repeat(41)].map((text) => ({
    text,
    tokens: estimateTokens(text),
  }));
}

/** Builds the fixture of kept func helper cases. */
export async function buildFuncHelpersFixture(): Promise<object> {
  return {
    default_delimiter: DEFAULT_CONTEXT_ITEM_DELIMITER,
    git_tracking: gitTrackingCases(),
    fit_context_items: await fitContextCases(),
    redaction: redactionCases(),
    trusted_caller: [
      { role: "role", trusted: ["role", "other"] },
      { role: "", trusted: ["", "role"] },
      { role: "missing", trusted: ["role"] },
    ].map(({ role, trusted }) => ({
      agent_role: role,
      trusted_roles: trusted,
      trusted: isTrustedDogfoodCaller(role, new Set(trusted)),
    })),
    repair_json: repairCases(),
    transforms: transformCases(),
    portal_context: portalContextCases(),
    code_parser: codeParserCases(),
    estimate_tokens: estimateCases(),
  };
}

function sampleKnowledge(): IPortalKnowledge {
  return PortalKnowledgeSchema.parse({
    portal: "sample",
    gatheredAt: "2026-09-22T00:00:00.000Z",
    version: 1,
    architectureOverview: "A sample project with payments",
    layers: [{
      name: "services",
      paths: ["src/services"],
      responsibility: "Handles payments",
      keyFiles: ["src/services/payment.ts"],
    }],
    keyFiles: [{
      path: "tests/payment_test.ts",
      role: "test-helper",
      description: "Payment testing helpers",
    }, {
      path: "src/payment/router.ts",
      role: "routing",
      description: "Payment routing entrypoint",
    }],
    conventions: [{
      name: "testing",
      description: "Test all payment routes",
      examples: ["tests/payment_test.ts"],
      category: "testing",
      evidenceCount: 1,
      confidence: "high",
    }],
    dependencies: [],
    techStack: { primaryLanguage: "TypeScript", framework: "Hono" },
    symbolMap: [{
      name: "PaymentRouter",
      kind: "class",
      file: "src/services/payment.ts",
      signature: "class PaymentRouter",
      doc: "Routes payments",
    }, {
      name: "AuthStore",
      kind: "class",
      file: "src/auth/store.ts",
      signature: "class AuthStore",
      doc: "Stores credentials",
    }],
    stats: { totalFiles: 3, totalDirectories: 3, extensionDistribution: { ".ts": 3 } },
    metadata: { durationMs: 0, mode: "standard", filesScanned: 3, filesRead: 3 },
  });
}

const PORTAL_PATH_INPUTS = [
  "src/a.ts",
  "./src\\services\\a.ts",
  "/abs/path",
  "C:\\win\\path",
  "../escape",
  "a/../b",
  "",
  ".",
  "src//deep///file.ts",
  "ｆｕｌｌ/ｗｉｄｔｈ.ts",
  "bad\u0000name",
  "zero\u200bwidth",
];

const SANITIZE_INPUTS = [
  "plain text",
  "  spaced   out  ",
  "line\nbreak\ttab",
  "ﬁne ｆｕｌｌ ① x²",
  "markdown *bold* `code` [link](url) # head > quote | pipe!",
  "ctrl\u0000char\u200bhidden",
  "",
];

const PORTAL_SIGNALS = [
  { userPrompt: "Review the auth store", filePaths: ["./src\\services\\payment.ts"] },
  { userPrompt: "PaymentRouter routes payments" },
  { userPrompt: "", taskType: "testing", tags: ["payment"] },
  { userPrompt: "" },
  { userPrompt: "unrelated words", filePaths: ["lib/other/Payment.ts"] },
  { userPrompt: "ＰＡＹＭＥＮＴ router", filePaths: ["src/payment/router.ts", "../bad"] },
];

const ADAPTIVE_OPTIONS = [
  [PORTAL_TOKEN_LIMIT_WIDE, PORTAL_CORE_LIMIT_WIDE, PORTAL_ENTRY_LIMIT],
  [PORTAL_TOKEN_LIMIT_NARROW, PORTAL_CORE_LIMIT_NARROW, PORTAL_ENTRY_LIMIT],
  [PORTAL_TOKEN_LIMIT_WIDE, PORTAL_CORE_LIMIT_WIDE, 1],
  [0, PORTAL_CORE_LIMIT_WIDE, PORTAL_ENTRY_LIMIT],
  [PORTAL_TOKEN_LIMIT_WIDE, 0, PORTAL_ENTRY_LIMIT],
  [10, 10, PORTAL_ENTRY_LIMIT],
];

/** Builds the fixture of kept portal knowledge helper cases. */
export async function buildPortalKnowledgeFixture(): Promise<object> {
  const knowledge = sampleKnowledge();
  const adaptive: object[] = [];
  for (const signals of PORTAL_SIGNALS) {
    for (const [available, core, entries] of ADAPTIVE_OPTIONS) {
      const options = {
        tokenizer: SAMPLE_TOKENIZER,
        modelId: SAMPLE_MODEL,
        availableTokens: available,
        coreMaxTokens: core,
        relevantMaxEntries: entries,
      };
      adaptive.push({
        signals,
        available_tokens: available,
        core_max_tokens: core,
        relevant_max_entries: entries,
        result: await buildAdaptivePortalKnowledge(knowledge, signals, options),
      });
    }
  }
  return {
    model: SAMPLE_MODEL,
    knowledge,
    normalize_path: PORTAL_PATH_INPUTS.map((path) => ({ path, normalized: normalizePortalPath(path) ?? null })),
    sanitize: SANITIZE_INPUTS.map((value) => ({ value, sanitized: sanitizePortalKnowledgeText(value) })),
    score: PORTAL_SIGNALS.map((signals) => ({ signals, entries: scorePortalKnowledge(knowledge, signals) })),
    adaptive,
  };
}

/** Builds the frontmatter parsing cases that cover accepted and rejected documents. */
export function buildFrontmatterCases(): object[] {
  const parser = new FrontmatterParser();
  const uuid = "11111111-2222-4333-8444-555555555555";
  const inputs = [
    `---\ntrace_id: "${uuid}"\nagent_role: coder\nstatus: pending\npriority: 7\ntags: [a, b]\nrunner_kind: cli\n---\nbody text`,
    `---\ntrace_id: "${uuid}"\nagent_role: coder\nstatus: pending\n---\n`,
    `---\ntrace_id: "${uuid}"\nagent_role: coder\nstatus: pending\n---`,
    `---\ntrace_id: "${uuid}"\nagent_role: coder\nstatus: pending\nextra: ignored\n---\nbody\n---\nmore`,
    `---\ntrace_id: not-a-uuid\nagent_role: coder\nstatus: pending\n---\nbody`,
    `---\ntrace_id: "${uuid}"\nagent_role: ""\nstatus: bogus\n---\nbody`,
    `---\nkey: [unclosed\n---\nbody`,
    "---\nplain scalar\n---\nbody",
    "---\n\n---\nbody",
    "---\r\ntrace_id: x\r\n---\r\nbody",
    `body first\n---\ntrace_id: "${uuid}"\n---\n`,
  ];
  return inputs.map((input) => {
    const error = messageOf(() => parser.parse(input));
    if (error) return { input, error };
    const parsed = parser.parse(input);
    return {
      input,
      body: parsed.body,
      trace_id: parsed.request.trace_id,
      agent_role: parsed.request.agent_role,
      status: parsed.request.status,
      priority: parsed.request.priority,
      tags: parsed.request.tags,
      runner_kind: parsed.request.runner_kind ?? null,
    };
  });
}
