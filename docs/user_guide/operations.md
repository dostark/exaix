# Operations

Backup, restore, upgrade, troubleshooting, uninstall, daemon control and health checks. Part of the [Exaix User Guide](README.md).

## **Daemon Commands** - Control the Exaix daemon

Manage the background daemon process:

```bash
# Start the daemon (runs in background, returns to prompt)
exactl daemon start

# Alternative: start via deno task (also backgrounds)
deno task start:bg

# For development: run in foreground (blocks terminal, shows live output)
deno task start

# Stop the daemon gracefully
exactl daemon stop

# Restart the daemon
exactl daemon restart

# Check daemon status
exactl daemon status

# View daemon logs
exactl daemon logs
exactl daemon logs --limit 100           # Show last 100 lines
exactl daemon logs --follow              # Stream logs (like tail -f)
```

## **Migrate Command** - Check workspace schema compatibility

When upgrading Exaix, the workspace schema version may change. `exactl doctor --schema`
compares the binary's expected schema version against the workspace's stored version.

```bash
# Check schema compatibility
exactl doctor --schema
```

If versions mismatch, the command reports the expected and actual versions and
recommends migration steps. This is also checked automatically at daemon start.

---

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

**Complete workflow example:**

```bash
# 1. Create a request (quick method - recommended)
exactl request create "Implement user authentication for the API"
# Output: ✓ Request created: request-a1b2c3d4.md

# Alternative: Manual file creation (if you need custom frontmatter)
# echo "Implement user authentication" > ~/Exaix/Workspace/Requests/auth.md

# 2. Agent will generate a plan automatically
# Wait a moment... (daemon watches Workspace/Requests)

# 3. Review the plan
exactl plan list
exactl plan show implement-auth

# 4. Approve the plan
exactl plan approve implement-auth

# 5. Review changes created by agents
exactl review list
exactl review show implement-auth

# 6. Approve the review to merge
exactl review approve implement-auth

# Current Status:
# ✅ Request creation automated
# ✅ Plan generation automated
# ✅ Plan approval workflow complete
# ✅ Plan detection and parsing implemented
# ✅ Review creation and approval available
# 🚧 Full agent-driven execution in development

# All completed steps logged to Activity Journal with trace_id
```

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

# 2. Backup current version (see 12.1)
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

### Health Check

```bash
# Check daemon status
exactl daemon status

# Output:
# 🔧 Daemon Status
# Version: 1.0.0
# Status: Running ✓
# PID: 12345
# Uptime: 2:15:30

# View recent activity
exactl daemon logs --limit 20

# Check git repository status
exactl git status

# List pending work
exactl plan list
exactl review list

# View all branches
exactl git branch list
```

## Daemon Management & Monitoring

Exaix can run as a background daemon to serve the MCP API, run scheduled tasks, and monitor workspace health.

### Daemon Control

Use the `exactl daemon` command to manage the background service:

```bash
# Start the daemon
exactl daemon start

# Check status (PID, uptime, version)
exactl daemon status

# View live logs
exactl daemon logs -f

# Stop the daemon (sends SIGTERM for graceful shutdown)
exactl daemon stop
```

> [!TIP]
> **Graceful Shutdown:** The daemon handles shutdown signals to ensure critical operations (like database writes or git commits) complete before exiting.

### Health Checks

The daemon exposes health endpoints and performs self-monitoring. checking:

- **Database Connectivity**: Verifies SQLite WAL mode and query response.
- **Disk Space**: Monitoring `warn` and `critical` thresholds.
- **Memory Usage**: Tracks heap usage to prevent OOM errors.

```bash
# Perform an ad-hoc health check
exactl daemon status
```
