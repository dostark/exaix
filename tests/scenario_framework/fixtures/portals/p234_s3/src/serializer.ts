/** A serializer with a round-trip contract. */
export class SerializerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerializerError";
  }
}

/** Encodes a string as UTF-8 bytes. */
export function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Decodes UTF-8 bytes. Malformed bytes throw SerializerError. */
export function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SerializerError("Malformed UTF-8 bytes");
  }
}
