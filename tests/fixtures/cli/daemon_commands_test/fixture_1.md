// Mock daemon for testing
console.log("Daemon started");
const shutdown = () => {
console.log("Daemon stopping");
Deno.exit(0);
};
Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);
// Keep alive
await new Promise(() => {});
