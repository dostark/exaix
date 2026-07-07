# Exaix — Deployed Workspace

This directory represents a deployed runtime workspace created from the Exaix repository.

## Quick Start

1. Configure settings via `exactl config set`:

```bash
exactl config set ai.provider ollama
exactl config set ai.model llama3.2
```

2. Start the daemon:

```bash
exactl daemon start
```

3. Verify status:

```bash
exactl daemon status
```

4. Create your first request:

```bash
exactl request "Add a hello world function"
```

## Daemon Management

```bash
exactl daemon start    # Start in background
exactl daemon stop     # Stop gracefully
exactl daemon status   # Check if running
exactl daemon restart  # Restart daemon
```

## Directory Structure

- `Blueprints/` — Agent definitions and templates
- `Workspace/` — Requests, Plans, and Changesets
- `Memory/` — Persistent memory banks (copied during deploy)
- `.exa/` — Runtime state: DB, logs, active tasks
- `Portals/` — Symlinks to external project repositories
- `exa.config.toml` — Bootstrap config (system.root, schema_version; all other settings via `exactl config set`)

## Getting Help

```bash
exactl --help
exactl config --help
exactl request --help
exactl plan --help
exactl portal --help
```
