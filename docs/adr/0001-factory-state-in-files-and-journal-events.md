# ADR-0001: Factory state lives in files and journal events

- **Status:** Accepted
- **Date:** 2026-11-24
- **Supersedes:** the versioned Factory tables of strategy decision D43 (strategy v0.21.0)
- **Owner:** repository owner

## Context

Exaix treats files as its API: requests, plans and configuration are files, and the file system is the
source of truth ([ARCHITECTURE.md § Files as API](../../ARCHITECTURE.md#1-files-as-api)). The
SQLite database exists for the Activity Journal, an append-only record with a SHA-256 hash chain.
Team stores the journal in append-only PostgreSQL, and Enterprise stores it in WORM immudb.

Decision D43 of the [Go port strategy](../../exaix-dev-docs/dev/Exaix_Go_Port_Strategy.md) added
versioned, mutable Factory tables (`runs`, `steps`, `effect_intents`, `decisions`, `checkpoints`)
next to the journal. That breaks the file principle, and mutable tables have no natural home in the
append-only Team tier or the WORM Enterprise tier.

The Factory still needs the security properties that D43 was written for:

- a decision or an approval grant is consumed once (SEC-07);
- one executor admits each effect, and a stale executor is fenced out (SEC-07);
- the intent of an effect is durable before dispatch, and an unknown outcome stays parked (F4);
- the state change and its audit record cannot diverge after a crash (SEC-11).

## Decision

1. **Write-once content is a file.** A run specification, acceptance criteria, policy, plan, evidence
   and an escalation payload are content-addressed files. They are written to a temporary file and
   renamed into place, so a crash leaves either the old state or the complete new file.
1. **Every state change is a journal event.** Run state changes, a recorded decision, a consumed
   decision, approval grant state changes, an intended, finished or unknown effect, and a resolved
   escalation are events in the kept journal. Each event carries the digest of the content file it
   refers to, so the hash chain also covers the files.
1. **Current state is derived.** The state of a run, decision, grant or effect is a fold over the
   events of its run. A rendered status file is only a view and is never read back as truth.
1. **Single use is enforced in the journal transaction.** A consumer takes the journal write lock,
   checks the earlier events, and then appends the new event, all in one transaction. Solo uses
   SQLite `BEGIN IMMEDIATE`. Team uses a transaction-scoped PostgreSQL advisory lock keyed by the
   claim key. The journal sequence of the appended event is the fencing token.
1. **A table outside the journal needs a reason.** A database table other than the journal is allowed
   only for data that files cannot keep crash-safe: a crash or a race between two writers could produce
   a wrong security result that an atomic rename or an exclusive create cannot prevent, and the record
   must commit in the same transaction as its journal event. The Factory adds no such table.

## Consequences

- The journal format and hash chain stay unchanged. The event catalog grows by the Factory
  transition events.
- The Go Factory types separate write-once content from transitions. Stored flags such as a consumed
  decision, the state of a grant and the status of an effect become derived values.
- Stage 4 needs a synchronous, acknowledged journal append. The current TypeScript journal writer
  batches its writes, so it cannot serve as the transaction for a state change.
- Each storage tier needs a test in which two writers consume the same decision and exactly one
  succeeds.
- Event schemas are kept forever. A changed event shape is a new event version, and a fold reads
  every version it has seen.
- A file in the workspace can be changed by an agent. A reader verifies the digest that the journal
  recorded before it trusts the file.
- Tables that already exist in the TypeScript journal database are not covered by this decision.
  Whether each one passes the rule in the last point of the decision is a separate review.

## Options considered

| Option                                                     | Result                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Mutable versioned Factory tables (D43 as of v0.21.0)       | Rejected: breaks the file principle and the append-only journal tiers    |
| Mutable state files plus journal audit rows                | Rejected: no atomic link between a file write and its journal row        |
| Journal only, content included in events                   | Rejected: large content enters the journal and every replicated sink     |
| Files plus journal events plus an insert-only claims table | Rejected by the owner: single use is enforced in the journal transaction |
| **Files plus journal events**                              | **Accepted**                                                             |

## Review

Review this decision before the Stage 4 storage gate, or earlier if a Factory record fails the table
rule in the last point of the decision and is not a single-use claim.
