/**
 * @module CredentialSecurityTest
 * @path tests/security/credential_security_test.ts
 * @description Verifies the 'SecureCredentialStore', ensuring robust encryption
 * and secure lifecycle management of agent secrets and API keys.
 */

import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI } from "@exaix/ai";

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { SecureCredentialStore } from "@exaix/core";

// ============================================================================
// Unit Tests for SecureCredentialStore
// ============================================================================

Deno.test("SecureCredentialStore: encrypts and decrypts correctly", async () => {
  const testKey = "sk-test123456789";
  await SecureCredentialStore.set("test", testKey);

  const retrieved = await SecureCredentialStore.get("test");
  assertEquals(retrieved, testKey);
});

Deno.test("SecureCredentialStore: returns null for non-existent keys", async () => {
  const retrieved = await SecureCredentialStore.get("nonexistent");
  assertEquals(retrieved, null);
});

Deno.test("SecureCredentialStore: clears memory securely", async () => {
  const testKey = "sk-test123456789";
  await SecureCredentialStore.set("test", testKey);

  // Verify key is stored (encrypted)
  const stored = SecureCredentialStore["store"].get("test");
  assertExists(stored);

  SecureCredentialStore.clear("test");

  // Verify memory is overwritten and removed
  const cleared = SecureCredentialStore["store"].get("test");
  assertEquals(cleared, undefined);

  // Verify get returns null
  const retrieved = await SecureCredentialStore.get("test");
  assertEquals(retrieved, null);
});

Deno.test("SecureCredentialStore: stored data is encrypted", async () => {
  const testKey = "sk-test123456789";
  await SecureCredentialStore.set("test", testKey);

  // Verify store contains encrypted data, not plaintext
  const stored = SecureCredentialStore["store"].get("test");
  assertExists(stored);

  // The stored data should not contain the plaintext key
  const storedString = new TextDecoder().decode(stored);
  assertNotEquals(storedString, testKey);

  // But we should be able to decrypt it back
  const retrieved = await SecureCredentialStore.get("test");
  assertEquals(retrieved, testKey);
});

Deno.test("SecureCredentialStore: different keys for different names", async () => {
  const key1 = "sk-anthropic123";
  const key2 = "sk-openai456";

  await SecureCredentialStore.set(PROVIDER_ANTHROPIC, key1);
  await SecureCredentialStore.set(PROVIDER_OPENAI, key2);

  const retrieved1 = await SecureCredentialStore.get(PROVIDER_ANTHROPIC);
  const retrieved2 = await SecureCredentialStore.get(PROVIDER_OPENAI);

  assertEquals(retrieved1, key1);
  assertEquals(retrieved2, key2);
  assertNotEquals(retrieved1, retrieved2);
});

Deno.test("SecureCredentialStore: clear only affects specified key", async () => {
  const key1 = "sk-anthropic123";
  const key2 = "sk-openai456";

  await SecureCredentialStore.set(PROVIDER_ANTHROPIC, key1);
  await SecureCredentialStore.set(PROVIDER_OPENAI, key2);

  SecureCredentialStore.clear(PROVIDER_ANTHROPIC);

  const retrieved1 = await SecureCredentialStore.get(PROVIDER_ANTHROPIC);
  const retrieved2 = await SecureCredentialStore.get(PROVIDER_OPENAI);

  assertEquals(retrieved1, null);
  assertEquals(retrieved2, key2);
});

Deno.test("SecureCredentialStore: handles empty string values", async () => {
  const emptyKey = "";
  await SecureCredentialStore.set("empty", emptyKey);

  const retrieved = await SecureCredentialStore.get("empty");
  assertEquals(retrieved, emptyKey);
});

Deno.test("SecureCredentialStore: handles special characters", async () => {
  const specialKey = "sk-123!@#$%^&*()_+{}|:<>?[]\\;',./";
  await SecureCredentialStore.set("special", specialKey);

  const retrieved = await SecureCredentialStore.get("special");
  assertEquals(retrieved, specialKey);
});

// ============================================================================
// Integration Tests with Provider Factory
// ============================================================================

Deno.test("SecureCredentialStore: simulates environment variable initialization", async () => {
  // Simulate the initialization process without actually accessing env
  const anthropicKey = "sk-ant-test123";
  const openaiKey = "sk-openai-test456";
  const googleKey = "sk-google-test789";

  // Initialize secure store (simulate startup)
  await SecureCredentialStore.set("ANTHROPIC_API_KEY", anthropicKey);
  await SecureCredentialStore.set("OPENAI_API_KEY", openaiKey);
  await SecureCredentialStore.set("GOOGLE_API_KEY", googleKey);

  // Verify keys are accessible from secure store
  const storedAnthropicKey = await SecureCredentialStore.get("ANTHROPIC_API_KEY");
  const storedOpenaiKey = await SecureCredentialStore.get("OPENAI_API_KEY");
  const storedGoogleKey = await SecureCredentialStore.get("GOOGLE_API_KEY");

  assertEquals(storedAnthropicKey, anthropicKey);
  assertEquals(storedOpenaiKey, openaiKey);
  assertEquals(storedGoogleKey, googleKey);

  // Clean up
  SecureCredentialStore.clear("ANTHROPIC_API_KEY");
  SecureCredentialStore.clear("OPENAI_API_KEY");
  SecureCredentialStore.clear("GOOGLE_API_KEY");
});

Deno.test("SecureCredentialStore: clearAll removes all credentials", async () => {
  await SecureCredentialStore.set("key1", "value1");
  await SecureCredentialStore.set("key2", "value2");
  await SecureCredentialStore.set("key3", "value3");

  // Verify they're stored
  assertExists(await SecureCredentialStore.get("key1"));
  assertExists(await SecureCredentialStore.get("key2"));
  assertExists(await SecureCredentialStore.get("key3"));

  // Clear all
  SecureCredentialStore.clearAll();

  // Verify they're gone
  assertEquals(await SecureCredentialStore.get("key1"), null);
  assertEquals(await SecureCredentialStore.get("key2"), null);
  assertEquals(await SecureCredentialStore.get("key3"), null);
});
