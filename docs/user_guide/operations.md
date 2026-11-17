# Operations

Backup, restore, upgrade, troubleshooting, uninstall, daemon control and health checks. Part of the [Exaix User Guide](README.md).

## Running the daemon

Exaix runs as a background daemon. It serves the MCP API, runs scheduled tasks, and monitors workspace health. The `exactl daemon` command manages it:

- `exactl daemon start` starts the daemon in the background and returns to the prompt. `deno task start` runs the same command through the task runner.
- `exactl daemon status` shows the PID, the uptime and the version.
- `exactl daemon logs` shows the daemon log. It shows 50 lines by default, `--limit` changes that, and `--follow` streams the log like `tail -f`.
- `exactl daemon restart` restarts the daemon, and `exactl daemon stop` sends SIGTERM for a graceful shutdown.

> [!TIP]
> **Graceful Shutdown:** The daemon handles shutdown signals to ensure critical operations (like database writes or git commits) complete before exiting.

Every option is in the [daemon command reference](../cli/daemon.md). [Monitoring and Logs](monitoring.md) shows how to follow what the daemon does through the Activity Journal.

## Health checks

The daemon exposes health endpoints and performs self-monitoring. It checks:

- **Database connectivity:** Verifies SQLite WAL mode and query response.
- **Disk space:** Monitors the `warn` and `critical` thresholds.
- **Memory usage:** Tracks heap usage to prevent out-of-memory errors.

`exactl daemon status` shows whether the daemon runs, and `exactl doctor` runs the read-only checks of the workspace. See [Health Check and Shell Completion](cli-basics.md#health-check-and-shell-completion). For a quick look at the whole system, read the last lines of the daemon log with `exactl daemon logs --limit 20`, and list the pending work with `exactl plan list` and `exactl review list`. `exactl git status` and `exactl git branch list` show the state of the repository and the branches that agents created.

## Schema check

When you upgrade Exaix, the workspace schema version may change. `exactl doctor --schema` compares the schema version that the binary expects with the version stored in the workspace. If the versions differ, the command reports both and recommends migration steps. The daemon also checks this at start.

## Bootstrap a workspace

Use these steps to set up a workspace from the source checkout and start the daemon:

1. Deploy the workspace: `deno run -A scripts/deploy_workspace.ts --destination ~/Exaix`.
1. Change into it: `cd ~/Exaix`.
1. Cache the dependencies: `deno task cache`.
1. Initialize the database and the system: `deno task setup`.
1. Start the daemon: `exactl daemon start`.
1. Check that it runs: `exactl daemon status`. The command prints the PID and the uptime.

To send your first request, see [Getting Started](getting-started.md) and [Requests, Plans and Reviews](requests-plans-reviews.md).

## Operational procedures

### Backup

Stop the daemon first, so that the database is consistent: `exactl daemon stop`. Then archive the workspace and check the archive:

```bash
tar -czf exaix-backup-$(date +%Y%m%d).tar.gz \
  --exclude='*.log' \
  --exclude='deno-dir' \
  ~/Exaix

# Expected: a list of paths under Exaix/
tar -tzf exaix-backup-*.tar.gz | head
```

Back up these items separately:

- **Project code.** Portals are symlinks, not code. The projects they point to, for example `~/Dev/*`, need their own backup.
- **Secrets in the OS keyring.** Your OS backup tools handle them.

### Restore

1. Extract the archive: `tar -xzf exaix-backup-20251120.tar.gz -C ~/`.
1. Check the portal symlinks with `ls -la ~/Exaix/Portals`. If a project moved, a symlink is broken. Add the portal again with `exactl portal add <target-path> <alias>`.
1. Start the daemon: `exactl daemon start`.

### Upgrade Exaix

1. Stop the daemon: `exactl daemon stop`.
1. Back up the current version, as described in [Backup](#backup).
1. Pull the latest code: `git pull origin main` in your checkout.
1. Read `docs/CHANGELOG.md` for breaking changes.
1. Run the migrations: `deno task migrate up`.
1. Clear the Deno cache, which forces recompilation: `deno cache --reload apps/daemon/main.ts`.
1. Start the daemon with `exactl daemon start` and check it with `exactl daemon status`.

`deno task migrate up` also adds missing activity cache-token columns to an existing journal, even when its initialization migration is already recorded. Existing rows and cache values are preserved. Newly added columns contain NULL until a provider reports cache usage. Repeating the command is safe. The `scripts/setup_db.ts` setup command performs the same repair. Stop the daemon and back up the workspace before you run either command against an existing journal. Historical payload-only cache values are not backfilled.

### Troubleshooting

**An agent is stuck or does not respond.**

1. Run `exactl daemon status` and `exactl daemon logs --limit 50` to see whether the daemon runs and what it reports.
1. Run `exactl git branch list --pattern "feat/*"` to see the branches that agents created, and `exactl review list` to see what they produced.
1. If the daemon does not recover, run `exactl daemon restart`.

**A plan does not run.**

1. Run `exactl plan list`, then `exactl plan show <plan-id>`. The daemon runs only approved plans.
1. If the status is `review`, approve the plan with `exactl plan approve <plan-id>`.
1. Follow the daemon log with `exactl daemon logs --follow` and look for errors.

**Code changes are not visible.**

1. Run `exactl review list` and `exactl review show <review-id>` to find the change. The change waits on a feature branch until you approve the review.
1. Check `exactl git status` and `exactl git branch list` to see where the branch is.

**The database is corrupt.** Stop the daemon first, then check the journal:

```bash
exactl daemon stop

# Expected output: ok
sqlite3 ~/Exaix/.exa/journal.db "PRAGMA integrity_check;"
```

If the check reports errors, restore the journal from a backup with `cp ~/backups/journal.db ~/Exaix/.exa/journal.db`. Without a backup, delete `~/Exaix/.exa/journal.db`, run `deno task setup` to create an empty database, and accept that the activity history is lost. Then run `exactl daemon start`.

**Permission errors.** Run `exactl daemon status` and `exactl daemon logs` to read the error. Check that the workspace paths are accessible, for example with `ls -la ~/Exaix/Workspace ~/Exaix/.exa`. The permission flags of the daemon come from `deno.json`. After you fix them, run `exactl daemon restart`.

### Uninstall

1. Stop the daemon: `exactl daemon stop`.
1. Remove the Exaix directory: `rm -rf ~/Exaix`.
1. If you installed the CLI globally, remove it: `rm ~/.deno/bin/exactl`.

Portals are symlinks, so your projects stay untouched. Remove a project directory yourself if you no longer need it.
