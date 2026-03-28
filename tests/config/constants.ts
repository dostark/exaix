/**
 * @module ConfigConstantsTest
 * @path tests/config/constants.ts
 * @description Verifies the project's configuration constants, ensuring stable
 * default values for system paths, timeouts, and resource limits.
 */

// ============================================================================
// Testing Constants
// ============================================================================
// This module contains constants used exclusively in test files.
// For production constants, see src/config/constants.ts

import { DEFAULT_BLUEPRINT_VERSION, DEFAULT_SKILL_INDEX_VERSION } from "../../src/shared/constants.ts";

// Test Prompts
export const REGRESSION_TEST_PROMPT = "Hello, reply with 'OK'";
export const TEST_LOG_PREVIEW_LENGTH = 50;

// Test Timeouts (in milliseconds)
export const REGRESSION_TEST_TIMEOUT_MS = 30000;

// ============================================================================
// Provider / Transport Test Constants
// ============================================================================

// Use minimal retry/backoff in unit tests to avoid slowing the suite.
export const TEST_RETRY_MAX_ATTEMPTS_SINGLE = 1;
export const TEST_RETRY_BACKOFF_BASE_MS_ZERO = 0;
export const TEST_PROVIDER_TIMEOUT_MS_SHORT = 50;

// Subprocess tests
export const TEST_SUBPROCESS_TIMEOUT_MS_SHORT = 200;
export const TEST_SUBPROCESS_LONG_RUNNING_MS = 2000;
export const TEST_SUBPROCESS_ABORT_DELAY_MS = 50;

// MCP CLI / Server tests
export const TEST_MCP_PORT = 34567;
export const TEST_MCP_DEFAULT_PORT = 3000;

// AI Config Tests
export const TEST_AI_INVALID_URL = "invalid-url";
export const TEST_EMPTY_STRING = "";
export const TEST_CUSTOM_PROVIDER_TYPE = "custom-provider";
export const TEST_CUSTOM_PROVIDER_NAME = "Custom Provider";
export const TEST_CUSTOM_PROVIDER_DESCRIPTION = "Custom provider for tests";
export const TEST_CUSTOM_PROVIDER_CAPABILITY = "chat";
export const TEST_CUSTOM_PROVIDER_STRENGTH = "general";
export const TEST_CUSTOM_PROVIDER_ID = "custom-provider-id";
export const TEST_CUSTOM_PROVIDER_RESPONSE = "custom-response";
export const TEST_CUSTOM_PROVIDER_MODEL = "custom-provider-model";

// Memory formatter tests
export const TEST_PORTAL_NAME = "test-portal";
export const TEST_PROJECT_OVERVIEW = "Project overview";
export const TEST_PATTERN_NAME = "IPattern A";
export const TEST_PATTERN_DESCRIPTION = "IPattern description";
export const TEST_PATTERN_EXAMPLE = "src/pattern.ts";
export const TEST_PATTERN_TAG = "pattern-tag";
export const TEST_DECISION_DATE = "2026-02-08";
export const TEST_DECISION_TEXT = "Adopt design";
export const TEST_DECISION_RATIONALE = "Reduce risk";
export const TEST_REFERENCE_PATH = "src/index.ts";
export const TEST_REFERENCE_DESCRIPTION = "Reference description";
export const TEST_TRACE_ID = "11111111-1111-4000-8000-000000000001";
export const TEST_REQUEST_ID = "req-123";
export const TEST_AGENT_NAME = "test-agent";
export const TEST_STARTED_AT = "2026-02-08T00:00:00.000Z";
export const TEST_COMPLETED_AT = "2026-02-08T01:00:00.000Z";
export const TEST_SUMMARY_TEXT = "Execution summary";
export const TEST_CONTEXT_FILE = "src/feature.ts";
export const TEST_LESSON_TEXT = "Lesson learned";
export const TEST_ERROR_TEXT = "Execution error";
export const TEST_SEARCH_QUERY = "query";
export const TEST_GLOBAL_VERSION = "1.0";
export const TEST_GLOBAL_UPDATED_AT = "2026-02-08T02:00:00.000Z";
export const TEST_GLOBAL_CATEGORY = "pattern";
export const TEST_GLOBAL_PROJECT = "demo-project";

// Memory skill tests
export const TEST_SKILL_ID = "quality-skill";
export const TEST_SKILL_NAME = "Quality Skill";
export const TEST_SKILL_DESCRIPTION = "Improve code quality through refactoring.";
export const TEST_SKILL_INSTRUCTIONS = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6";
export const TEST_SKILL_VERSION = DEFAULT_SKILL_INDEX_VERSION;
export const TEST_SKILL_KEYWORD = "refactor";
export const TEST_SKILL_TASK_TYPE = "code";
export const TEST_SKILL_TAG = "quality";
export const TEST_SKILL_REQUEST_TEXT = "Please refactor the module for quality.";
export const TEST_DERIVED_SKILL_NAME = "Derived Skill";
export const TEST_DERIVED_SKILL_DESCRIPTION = "Derived from learnings";
export const TEST_DERIVED_SKILL_INSTRUCTIONS = "Follow best practices.";
export const TEST_DERIVED_SKILL_ID = "derived-skill";

// Memory pending proposal tests
export const TEST_PENDING_LEARNING_TITLE = "Pending ILearning";
export const TEST_PENDING_LEARNING_DESCRIPTION = "Pending learning description";
export const TEST_PENDING_REASON = "Proposed from execution";

// Dashboard mock tests
export const TEST_SKILL_ID_USER = "tdd-methodology";
export const TEST_SKILL_ID_LEARNED = "api-design-learned";
export const TEST_AGENT_ID = "agent-1";
export const TEST_PROPOSAL_ID = "proposal-1";
export const TEST_UNKNOWN_PROPOSAL_ID = "proposal-unknown";

// Request parser tests
export const TEST_REQUEST_FILE_NAME = "request-test.md";
export const TEST_REQUEST_BODY = "Implement feature X";
export const TEST_REQUEST_TRACE_ID = "11111111-1111-4000-8000-000000000002";
export const TEST_REQUEST_CREATED_AT = "2026-02-08T03:00:00.000Z";
export const TEST_REQUEST_PRIORITY = "normal";
export const TEST_REQUEST_AGENT = "default";
export const TEST_REQUEST_SOURCE = "cli";
export const TEST_REQUEST_CREATED_BY = "tester@example.com";
export const TEST_REQUEST_STATUS_UNKNOWN = "unknown_status";
export const TEST_REQUEST_STATUS_VALID = "planned";
export const TEST_REQUEST_INVALID_YAML = "trace_id: [";
export const TEST_LOG_ACTION_FILE_NOT_FOUND = "file.not_found";
export const TEST_LOG_ACTION_FRONTMATTER_INVALID = "frontmatter.invalid";
export const TEST_LOG_ACTION_MISSING_TRACE_ID = "frontmatter.missing_trace_id";
export const TEST_LOG_ACTION_PARSE_FAILED = "file.parse_failed";

// Agent status tests
export const TEST_AGENT_STATUS_INVALID = "invalid-agent-status";

// Blueprint commands tests
export const TEST_BLUEPRINT_YAML_AGENT_ID = "yaml-inline-agent";
export const TEST_BLUEPRINT_YAML_NAME = "YAML Inline Agent";
export const TEST_BLUEPRINT_YAML_MODEL = "mock:test-model";
export const TEST_BLUEPRINT_YAML_CAPABILITY_ONE = "alpha";
export const TEST_BLUEPRINT_YAML_CAPABILITY_TWO = "beta";
export const TEST_BLUEPRINT_YAML_CREATED = "2026-02-10T00:00:00Z";
export const TEST_BLUEPRINT_YAML_CREATED_BY = "tester";
export const TEST_BLUEPRINT_YAML_VERSION = DEFAULT_BLUEPRINT_VERSION;
export const TEST_BLUEPRINT_MISSING_AGENT_ID = "missing-agent";
export const TEST_BLUEPRINT_NO_FRONTMATTER_ID = "no-frontmatter";
export const TEST_BLUEPRINT_NO_FRONTMATTER_CONTENT = "No frontmatter content";
export const TEST_BLUEPRINT_ERROR_MISSING_FRONTMATTER = "Missing or invalid TOML frontmatter";

// Graceful shutdown tests
export const TEST_SIGNAL_SIGINT = "SIGINT";
export const TEST_SIGNAL_SIGTERM = "SIGTERM";
export const TEST_EVENT_UNHANDLED_REJECTION = "unhandledrejection";
export const TEST_EVENT_ERROR = "error";
export const LOG_MSG_SIGNAL_HANDLERS_REGISTERED = "Signal handlers registered for graceful shutdown";
export const LOG_MSG_ERROR_HANDLERS_REGISTERED = "Error handlers registered for graceful shutdown";

// LlamaProvider offline tests
export const TEST_OLLAMA_ENDPOINT = "http://ollama.test/api/generate";
export const TEST_LLAMAPROVIDER_MODEL_LLAMA = "llama3.2:1b";
export const TEST_LLAMAPROVIDER_MODEL_CODELLAMA = "codellama:7b-instruct";
export const TEST_LLAMAPROVIDER_PROMPT = "Hello";
export const TEST_LLAMAPROVIDER_JSON_BODY = '{"ok":true}';

// Environment Keys
export const ENV_GOOGLE_API_KEY = "GOOGLE_API_KEY";
export const ENV_OPENAI_API_KEY = "OPENAI_API_KEY";
export const ENV_ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY";

// Log and Error Prefixes/Messages
export const LOG_PREFIX_GOOGLE_RESPONSE = "Google Response:";
export const LOG_PREFIX_GOOGLE_ERROR = "Google Provider Error:";
export const LOG_PREFIX_OPENAI_RESPONSE = "OpenAI Response:";
export const LOG_PREFIX_OPENAI_ERROR = "OpenAI Provider Error:";
export const LOG_PREFIX_ANTHROPIC_RESPONSE = "Anthropic Response:";
export const LOG_PREFIX_ANTHROPIC_ERROR = "Anthropic Provider Error (CAUGHT):";
export const LOG_MSG_ENDPOINT_REACHED = "✅ Endpoint reached (Access/Quota/Auth error confirmed)";
export const LOG_MSG_ENDPOINT_REACHED_ANHROPIC = "✅ Endpoint reached (Error caught but confirms connectivity)";
export const ERROR_MSG_HTTP_404 = "404";
export const ERROR_MSG_NOT_FOUND = "not_found";
export const LOG_MSG_NOT_FOUND_DETECTED = "❌ 404/Not Found Error Detected!";

// ============================================================================
// Schema Describer Test Constants
// ============================================================================

export enum SchemaDescriberKey {
  Name = "name",
  Age = "age",
  Tags = "tags",
  Status = "status",
}

export enum SchemaDescriberEnumValue {
  Active = "active",
  Inactive = "inactive",
}

export enum SchemaDescriberType {
  String = "string",
  Number = "number",
  Boolean = "boolean",
  Unknown = "unknown",
}

export enum SchemaDescriberToken {
  ArrayPrefix = "Array<",
  ArraySuffix = ">",
  EnumPrefix = "enum(",
  EnumSuffix = ")",
  EnumSeparator = " | ",
  OptionalPrefix = "optional(",
  OptionalSuffix = ")",
  Quote = '"',
  FieldSeparator = ": ",
}

// ============================================================================
// Journal Formatter / Commands Test Constants
// ============================================================================

export enum JournalFormat {
  Json = "json",
  Table = "table",
  Text = "text",
}

export const JOURNAL_FORMAT_JSON = JournalFormat.Json;
export const JOURNAL_FORMAT_TABLE = JournalFormat.Table;
export const JOURNAL_FORMAT_TEXT = JournalFormat.Text;

export enum JournalAction {
  Error = "test.error",
  Approve = "test.approve",
  Create = "test.create",
  Generic = "test.action",
}

export const JOURNAL_ACTION_ERROR = JournalAction.Error;
export const JOURNAL_ACTION_APPROVE = JournalAction.Approve;
export const JOURNAL_ACTION_CREATE = JournalAction.Create;
export const JOURNAL_ACTION_GENERIC = JournalAction.Generic;

export const JOURNAL_ID_ONE = "activity-1";
export const JOURNAL_ID_TWO = "activity-2";
export const JOURNAL_ID_THREE = "activity-3";

export const JOURNAL_TRACE_ID_ONE = "trace-1";
export const JOURNAL_TRACE_ID_TWO = "trace-2";
export const JOURNAL_TRACE_ID_THREE = "trace-3";

export const JOURNAL_ACTOR_USER = "user";
export const JOURNAL_IDENTITY_ID = "agent-identity-1";

export const JOURNAL_TARGET_SHORT = "target-short";
export const JOURNAL_TARGET_LONG = "target-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

export const JOURNAL_PAYLOAD = "{}";

export const JOURNAL_TIMESTAMP_ONE = "2026-01-01T00:00:00.000Z";
export const JOURNAL_TIMESTAMP_TWO = "2026-01-01T00:00:01.000Z";
export const JOURNAL_TIMESTAMP_THREE = "2026-01-01T00:00:02.000Z";

export const JOURNAL_TRUNCATE_MAX = 30;
export const JOURNAL_ELLIPSIS = "...";

export const JOURNAL_ACTIVITY_COUNT = 3;
export const JOURNAL_COUNT_VALUE = 2;

export const JOURNAL_DISTINCT_FIELD_ACTION = "action_type";
export const JOURNAL_TAIL_LIMIT = 5;
export const JOURNAL_CAPTURE_COUNT_ONE = 1;

export const JOURNAL_FILTER_TRACE = `trace_id=${JOURNAL_TRACE_ID_ONE}`;
export const JOURNAL_FILTER_ACTION = `action_type=${JournalAction.Generic}`;
export const JOURNAL_FILTER_IDENTITY = `identity_id=${JOURNAL_IDENTITY_ID}`;
export const JOURNAL_SINCE_VALUE = "2026-01-01T00:00:00.000Z";
export const JOURNAL_FILTER_SINCE = `since=${JOURNAL_SINCE_VALUE}`;
export const JOURNAL_FILTER_UNKNOWN = "unknown=foo";
export const JOURNAL_FILTER_INVALID = "invalidfilter";

export const JOURNAL_INVALID_FILTER_PREFIX = "Invalid filter format:";
export const JOURNAL_UNKNOWN_FILTER_PREFIX = "Unknown filter key:";

// ============================================================================
// Token Usage Regression Test Constants
// ============================================================================

// Test token counts for regression testing
export const TEST_PROMPT_TOKENS_GOOGLE = 10;
export const TEST_COMPLETION_TOKENS_GOOGLE = 5;
export const TEST_TOTAL_TOKENS_GOOGLE = 15;

export const TEST_PROMPT_TOKENS_OPENAI = 20;
export const TEST_COMPLETION_TOKENS_OPENAI = 10;
export const TEST_TOTAL_TOKENS_OPENAI = 30;

export const TEST_PROMPT_TOKENS_ANTHROPIC = 25;
export const TEST_COMPLETION_TOKENS_ANTHROPIC = 15;
export const TEST_TOTAL_TOKENS_ANTHROPIC = 40;

// Test model names for regression testing
export const TEST_MODEL_GOOGLE = "gemini-pro";
export const TEST_MODEL_OPENAI = "gpt-4o-mini";
export const TEST_MODEL_ANTHROPIC = "claude-3-7-sonnet-20250219";

// Test provider IDs for regression testing
export const TEST_PROVIDER_ID_GOOGLE = "google-gemini-pro";
export const TEST_PROVIDER_ID_OPENAI = "openai-gpt-4o-mini";
export const TEST_PROVIDER_ID_ANTHROPIC = "anthropic-claude-3-7-sonnet-20250219";

// Test provider IDs for error cases
export const TEST_PROVIDER_ID_GOOGLE_ERROR = "google-test";
export const TEST_PROVIDER_ID_OPENAI_ERROR = "openai-test";
export const TEST_PROVIDER_ID_ANTHROPIC_ERROR = "anthropic-test";

// ============================================================================
// Token Metrics Integration Test Constants
// ============================================================================

// Environment variable names
export const ENV_TEST_ENABLE_PAID_LLM = "EXA_TEST_ENABLE_PAID_LLM";
export const ENV_TEST_ENABLE_PAID_LLM_VALUE = "1";

// Test prompts for token metrics validation
export const TOKEN_METRICS_TEST_PROMPT = "Say OK";

// Model names for integration testing
export const TOKEN_METRICS_MODEL_GOOGLE = "gemini-2.5-flash";
export const TOKEN_METRICS_MODEL_OPENAI = "gpt-4o-mini";
export const TOKEN_METRICS_MODEL_ANTHROPIC = "claude-3-5-haiku-20241022";

// Wait times for async operations (milliseconds)
export const TOKEN_METRICS_ASYNC_WAIT_MS = 1000;

// Database query limits
export const TOKEN_METRICS_DB_QUERY_LIMIT = 10;

// Action type for token usage events
export const ACTION_TYPE_LLM_USAGE = "llm.usage";

// Skip messages for common API errors
export const SKIP_MSG_OPT_IN_REQUIRED =
  "EXA_TEST_ENABLE_PAID_LLM is not set to '1' (opt-in required to avoid API costs)";
export const SKIP_MSG_GOOGLE_API_KEY_MISSING = "GOOGLE_API_KEY not set";
export const SKIP_MSG_OPENAI_API_KEY_MISSING = "OPENAI_API_KEY not set";
export const SKIP_MSG_ANTHROPIC_API_KEY_MISSING = "ANTHROPIC_API_KEY not set";
export const SKIP_MSG_GOOGLE_INVALID_KEY = "Invalid API key (401)";
export const SKIP_MSG_GOOGLE_RATE_LIMIT = "Rate limit exceeded (429)";
export const SKIP_MSG_GOOGLE_MODEL_NOT_FOUND = "Model not found (404)";
export const SKIP_MSG_GOOGLE_QUOTA = "Insufficient quota (403)";
export const SKIP_MSG_OPENAI_INVALID_KEY = "Invalid API key (401)";
export const SKIP_MSG_OPENAI_RATE_LIMIT = "Rate limit exceeded (429)";
export const SKIP_MSG_OPENAI_MODEL_NOT_FOUND = "Model not found (404)";
export const SKIP_MSG_OPENAI_QUOTA = "Insufficient quota";
export const SKIP_MSG_ANTHROPIC_INVALID_KEY = "Invalid API key (401)";
export const SKIP_MSG_ANTHROPIC_RATE_LIMIT = "Rate limit exceeded (429)";
export const SKIP_MSG_ANTHROPIC_MODEL_NOT_FOUND = "Model not found (404)";
export const SKIP_MSG_ANTHROPIC_CREDITS = "Insufficient credits (400)";
export const SKIP_MSG_ANTHROPIC_QUOTA = "Insufficient quota (403)";

// Error message patterns for detection
export const ERROR_PATTERN_401 = "401";
export const ERROR_PATTERN_UNAUTHORIZED = "unauthorized";
export const ERROR_PATTERN_429 = "429";
export const ERROR_PATTERN_RATE_LIMIT = "rate limit";
export const ERROR_PATTERN_404 = "404";
export const ERROR_PATTERN_NOT_FOUND = "not found";
export const ERROR_PATTERN_400 = "400";
export const ERROR_PATTERN_CREDIT = "credit";
export const ERROR_PATTERN_BALANCE = "balance";
export const ERROR_PATTERN_403 = "403";
export const ERROR_PATTERN_QUOTA = "quota";

// Assertion messages
export const ASSERT_MSG_LLM_USAGE_EVENTS_GOOGLE = "Expected at least one llm.usage event for Google";
export const ASSERT_MSG_LLM_USAGE_EVENTS_OPENAI = "Expected at least one llm.usage event for OpenAI";
export const ASSERT_MSG_LLM_USAGE_EVENTS_ANTHROPIC = "Expected at least one llm.usage event for Anthropic";
export const ASSERT_MSG_PROMPT_TOKENS_EXISTS = "prompt_tokens should exist";
export const ASSERT_MSG_COMPLETION_TOKENS_EXISTS = "completion_tokens should exist";
export const ASSERT_MSG_TOTAL_TOKENS_EXISTS = "total_tokens should exist";
export const ASSERT_MSG_COST_USD_EXISTS = "cost_usd should exist";
export const ASSERT_MSG_MODEL_EXISTS = "model should exist";
export const ASSERT_MSG_PROMPT_TOKENS_GT_ZERO = "prompt_tokens should be > 0";
export const ASSERT_MSG_COMPLETION_TOKENS_GT_ZERO = "completion_tokens should be > 0";
export const ASSERT_MSG_TOTAL_TOKENS_GT_ZERO = "total_tokens should be > 0";
export const ASSERT_MSG_COST_USD_GT_ZERO = "cost_usd should be > 0";
export const ASSERT_MSG_RESPONSE_EXISTS = "Provider should return a response";
export const ASSERT_MSG_RESPONSE_NOT_EMPTY = "Response should not be empty";
