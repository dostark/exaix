/**
 * @module SecureRandom
 * @path packages/core/src/func/secure_random.ts
 * @description Cryptographically secure random number and string generation utilities.
 */

export class SecureRandom {
  /**
   * Generate cryptographically secure random bytes.
   */
  static getRandomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * Generate a cryptographically secure random number between 0 and 1.
   */
  static getRandomNumber(): number {
    const bytes = this.getRandomBytes(8);
    const view = new DataView(bytes.buffer);
    const randomInt = view.getUint32(0) / 0x100000000;
    return randomInt;
  }

  /**
   * Generate a cryptographically secure random integer in the specified range.
   */
  static getRandomInt(min: number, max: number): number {
    const range = max - min + 1;
    const randomNumber = this.getRandomNumber();
    return Math.floor(randomNumber * range) + min;
  }

  /**
   * Generate a URL-safe random string of specified length.
   */
  static getRandomString(length: number): string {
    const bytes = this.getRandomBytes(Math.ceil(length * 3 / 4));
    const base64url = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    return base64url.slice(0, length);
  }

  /**
   * Generate a cryptographically secure UUID v4.
   */
  static generateUUID(): string {
    return crypto.randomUUID();
  }

  /**
   * Generate a unique ID with optional prefix.
   */
  static generateId(prefix = "id"): string {
    const randomPart = this.getRandomString(16);
    return `${prefix}_${randomPart}`;
  }

  /**
   * Generate a secure session ID.
   */
  static generateSessionId(): string {
    return this.getRandomString(32);
  }

  /**
   * Generate a secure token as hex string.
   */
  static generateToken(byteLength: number): string {
    const bytes = this.getRandomBytes(byteLength);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
