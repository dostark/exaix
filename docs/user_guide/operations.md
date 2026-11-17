# Operations

Backup, restore, upgrade, troubleshooting, uninstall, daemon control and health checks. Part of the [Exaix User Guide](README.md).

## Running the daemon

Exaix runs as a background daemon. It serves the MCP API, runs scheduled tasks, and monitors workspace health. The `exactl daemon` command manages it:

- `exactl daemon start` starts the daemon in the background and returns to the prompt. `deno task start:bg` does the same, and `deno task start` runs it in the foreground for development, with live output.
- `exactl daemon status` shows the PID, the uptime and the version.
- `exactl daemon logs` shows the daemon log. It shows 50 lines by default, `--limit` changes that, and `--follow` streams the log like `tail -f`.
- `exactl daemon restart` restarts the daemon, and `exactl daemon stop` sends SIGTERM for a graceful shutdown.

> [!TIP]
> **Graceful Shutdown:** The daemon handles shutdown signals to ensure critical operations (like database writes or git commits) complete before exiting.

Every option is in the [daemon command reference](../cli/daemon.md). [Monitoring and Logs](monitoring.md) shows how to follow what the daemon does through the Activity Journal.

## Health checks

The daemon exposes health endpoints and performs self-monitoring. It checks:

- **Database Connectivity**: Verifies SQLite WAL mode and query response.
- **Disk Space**: Monitoring `warn` and `critical` thresholds.
- **Memory Usage**: Tracks heap usage to prevent OOM errors.

`exactl daemon status` shows whether the daemon runs, and `exactl doctor` runs the read-only checks of the workspace. See [Health Check and Shell Completion](cli-basics.md#health-check-and-shell-completion). For a quick look at the whole system, read the last lines of the daemon log with `exactl daemon logs --limit 20`, and list the pending work with `exactl plan list` and `exactl review list`. `exactl git status` and `exactl git branch list` show the state of the repository and the branches that agents created.

## Schema check

When you upgrade Exaix, the workspace schema version may change. `exactl doctor --schema` compares the schema version that the binary expects with the version stored in the workspace. If the versions differ, the command reports both and recommends migration steps. The daemon also checks this at start.

## Bootstrap (Reference Implementation)

```bash
# 1. Clone or deploy workspace
./scripts/deploy_workspace.sh ~/Exaix

# 2. Navigate to workspace
cd ~/Exaix

# 3. Cache dependencies
deno task cache

# 4. Initialize database and system
deno task setup

# 5. Start daemon
exactl daemon start
# or: deno task start

# 6. Verify daemon is running
exactl daemon status
```

To send your first request, see [Getting Started](getting-started.md) and [Requests, Plans and Reviews](requests-plans-reviews.md).

## Operational Procedures

### Backup

**Before Backup:**

```bash
# Stop daemon to ensure database consistency
deno task stop
```

**Backup Command:**

```bash
# Backup Exaix directory
tar -czf exaix-backup-$(date +%Y%m%d).tar.gz \
  --exclude='*.log' \
  --exclude='deno-dir' \
  ~/Exaix

# Verify backup
tar -tzf exaix-backup-*.tar.gz | head
```

**What to backup separately:**

- Portals are symlinks, not actual code
- Actual project code lives in `~/Dev/*` (backup separately)
- OS keyring secrets (handled by OS backup tools)

### Restore

```bash
# Extract backup
tar -xzf exaix-backup-20251120.tar.gz -C ~/

# Verify portal symlinks still work
cd ~/Exaix/Portals
ls -la

# Recreate broken symlinks if projects moved
deno task mount ~/Dev/MyProject MyProject

# Restart daemon
deno task start
```

### Upgrade Exaix

```bash
# 1. Stop daemon
deno task stop

# 2. Backup current version (see Backup above)
tar -czf exaix-pre-upgrade.tar.gz ~/Exaix

# 3. Pull latest code
cd ~/Exaix
git pull origin main

# 4. Check for breaking changes
cat CHANGELOG.md

# 5. Run migrations if needed
deno task migrate up

# 6. Clear Deno cache (forces re-compilation)
deno cache --reload apps/daemon/main.ts

# 7. Restart daemon
deno task start

# 8. Verify
deno task status
```

`deno task migrate up` also adds missing activity cache-token columns to an
existing journal, even when its initialization migration is already recorded.
Existing rows and cache values are preserved; newly added columns contain NULL
until a provider reports cache usage. Repeating the command is safe. The
`scripts/setup_db.ts` setup command performs the same repair. Stop the daemon
and back up the workspace before running either command against an existing
journal. Historical payload-only cache values are not backfilled.

### Troubleshooting

**Agent Stuck / Unresponsive:**

```bash
# Check daemon status
exactl daemon status

# View recent daemon logs
exactl daemon logs --limit 50

# Check active git branches
exactl git branch list --pattern "feat/*"

# View agent activity
exactl review list

# Restart daemon if needed
exactl daemon restart
```

**Plan Not Processing:**

```bash
# List pending plans
exactl plan list

# Check if plan is approved
exactl plan show <id>

# Approve if status is 'review'
exactl plan approve <id>

# Check daemon logs for errors
exactl daemon logs --follow
```

**Code Changes Not Visible:**

```bash
# List all reviews
exactl review list

# Show specific review details
exactl review show <id>

# Check git status
exactl git status

# View branches
exactl git branch list
```

**Database Corruption:**

```bash
# Stop daemon first
exactl daemon stop

# Check integrity
sqlite3 ~/Exaix/.exa/journal.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
cp ~/backups/journal.db ~/Exaix/.exa/journal.db

# If no backup, rebuild empty database
rm ~/Exaix/.exa/journal.db
deno task setup --db-only

# Restart daemon
exactl daemon start
```

**Permission Errors:**

```bash
# Check current Deno permissions
cat deno.json

# View daemon status for errors
exactl daemon status
exactl daemon logs

# Verify workspace paths are accessible
ls -la ~/Exaix/Workspace
ls -la ~/Exaix/.exa

# Restart with correct permissions
exactl daemon restart
```

### Uninstall

```bash
# 1. Stop daemon
exactl daemon stop

# 2. Remove Exaix directory
rm -rf ~/Exaix

# 3. Remove CLI tool from PATH (if installed globally)
rm ~/.deno/bin/exactl

# 4. Portals are just symlinks - actual projects untouched
# Nothing to clean unless you want to remove project directories
```
