/** Inserts a value once. Two concurrent callers can both pass the check. */
export async function insertOnce(store: string[], value: string): Promise<void> {
  const exists = store.includes(value);
  await Promise.resolve();
  if (!exists) store.push(value);
}
