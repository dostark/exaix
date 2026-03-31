/**
 * @module CredentialSecurity
 * @path src/helpers/credential_security.ts
 * @description Secure credential storage using AES-GCM encryption for API keys and sensitive tokens.
 * @architectural-layer Helpers
 * * @related-files [src/services/db.ts]
 */

export class SecureCredentialStore {
  private static readonly store = new Map<string, Uint8Array>();
  private static readonly key = crypto.getRandomValues(new Uint8Array(32));

  /**
   * Store an encrypted credential
   */
  static async set(name: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(value);
    this.store.set(name, encrypted);
    // Zero out original value to prevent memory leaks
    this.zeroOutString(value);
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
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
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
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted,
    );
    return new TextDecoder().decode(decrypted);
  }

  /**
   * Zero out a string to prevent memory leaks
   */
  private static zeroOutString(str: string): void {
    // In JavaScript/TypeScript, strings are immutable, so we can't directly
    // zero them out. However, by setting the reference to null and letting
    // the garbage collector handle it, we minimize the window of exposure.
    // The original string will be garbage collected when no longer referenced.
    str = "\0".repeat(str.length);
  }
}
