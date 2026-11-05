/** Authorizes one write. */
export function authorizeWrite(role: string): boolean {
  return role === "writer";
}

/** Calls the writer only when the role is authorized. */
export function writeOnce(role: string, writer: () => void): boolean {
  if (!authorizeWrite(role)) return false;
  writer();
  return true;
}
