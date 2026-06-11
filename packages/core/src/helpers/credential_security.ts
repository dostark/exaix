/**
 * @module CredentialSecurity
 * @path packages/core/src/helpers/credential_security.ts
 * @description In-memory credential holder for API keys and tokens.
 * @architectural-layer Helpers
 * @ungrounded
 * @related-files ["packages/storage-sqlite/src/database_service.ts"]
 *
 * SECURITY NOTE (Finding 11): this is **best-effort in-memory obfuscation, not a hard
 * security boundary**. Values are AES-GCM-encrypted, but the key is generated per
 * process and held in the same process memory as the ciphertext — an adversary with
 * process-memory access recovers both. It defends against accidental exposure (heap
 * dumps, casual inspection), not against an attacker who already runs code in-process.
 * For real secret protection use an OS keychain / secrets manager. Never log, print,
 * or include these values in error messages.
 */

export class SecureCredentialStore {
  private static readonly store = new Map<string, Uint8Array>();
  private static readonly key = crypto.getRandomValues(new Uint8Array(32));
  private static readonly ALGO = "AES-GCM";

  /**
   * Store an encrypted credential
   */
  static async set(name: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(value);
    this.store.set(name, encrypted);
  }

  /**
   * Retrieve and decrypt a credential
   */
  static async get(name: string): Promise<string | null> {
    const encrypted = this.store.get(name);
    if (!encrypted) return null;
    return await this.decrypt(encrypted);
  }

  /**
   * Securely clear a credential from memory
   */
  static clear(name: string): void {
    const data = this.store.get(name);
    if (data) {
      // Overwrite with random data before deletion
      crypto.getRandomValues(data);
      this.store.delete(name);
    }
  }

  /**
   * Clear all stored credentials (for shutdown)
   */
  static clearAll(): void {
    for (const name of this.store.keys()) {
      this.clear(name);
    }
  }

  /**
   * Encrypt data using AES-GCM
   */
  private static async encrypt(data: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey(
      "raw",
      this.key,
      { name: SecureCredentialStore.ALGO },
      false,
      ["encrypt"],
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: SecureCredentialStore.ALGO, iv },
      key,
      encoder.encode(data),
    );
    // Combine IV + encrypted data
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);
    return result;
  }

  /**
   * Decrypt data using AES-GCM
   */
  private static async decrypt(data: Uint8Array): Promise<string> {
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    const key = await crypto.subtle.importKey(
      "raw",
      this.key,
      { name: SecureCredentialStore.ALGO },
      false,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: SecureCredentialStore.ALGO, iv },
      key,
      encrypted,
    );
    return new TextDecoder().decode(decrypted);
  }
}
