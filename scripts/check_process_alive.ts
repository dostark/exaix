#!/usr/bin/env -S deno run -A
/**
 * @module CheckProcessAlive
 * @path scripts/check_process_alive.ts
 * @description Native-Deno process-liveness check for E2E scenarios — no `pgrep`/`sh` spawn.
 *   Enumerates running processes via Linux /proc (a process's cmdline is argv NUL-separated)
 *   and reports whether any surviving process's command line contains the given pattern. Used
 *   by the SSE liveness scenario to assert no MCP server process survives the probe.
 *   Prints `no leaked server` and exits 0 when no process matches, `LEAKED` and exits 1
 *   otherwise. Self-match is impossible: the helper's own cmdline is `deno run ...`.
 *   Usage: deno run -A scripts/check_process_alive.ts <substring-pattern>
 * @related-files [tests/scenario_framework/scenarios/mcp_server/sse-liveness.yaml]
 */

const pattern = Deno.args[0];

function runningCmdlines(): string[] {
  const cmdlines: string[] = [];
  // The helper's own argv and its ancestors' argv contain the pattern being searched for
  // (self-match) — exclude the whole chain so only genuinely independent processes count.
  const excluded = new Set<number>([Deno.pid]);
  for (let pid = Deno.pid; pid !== undefined && pid > 0;) {
    const parent = parentPid(pid);
    if (parent === undefined || parent === pid) break;
    excluded.add(parent);
    pid = parent;
  }
  for (const entry of Deno.readDirSync("/proc")) {
    if (!/^\d+$/.test(entry.name)) continue;
    if (excluded.has(Number(entry.name))) continue;
    let cmdline = "";
    try {
      cmdline = Deno.readTextFileSync(`/proc/${entry.name}/cmdline`);
    } catch {
      // The process exited between readdir and read; skip it.
    }
    const text = cmdline.replaceAll("\0", " ").trim();
    if (text) cmdlines.push(text);
  }
  return cmdlines;
}

/** The parent PID from /proc/<pid>/stat, or undefined when it cannot be read. */
function parentPid(pid: number): number | undefined {
  let stat = "";
  try {
    stat = Deno.readTextFileSync(`/proc/${pid}/stat`);
  } catch {
    return undefined;
  }
  // Format: `pid (comm) state ppid ...` — comm may contain spaces/parens, so anchor on the
  // LAST `)` and take the second whitespace field after it (state, ppid).
  const afterComm = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
  return Number(afterComm[1]);
}

const leaked = runningCmdlines().some((cmdline) => cmdline.includes(pattern));

if (leaked) {
  console.log("LEAKED");
  Deno.exit(1);
}
console.log("no leaked server");
