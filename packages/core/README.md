# @exaix/core

Core contracts, interfaces, and shared primitives for Exaix.

---

## Events Module

The `events/` sub-module (`@exaix/core/events`) provides the canonical event taxonomy and source-validation gate for the entire system.

### DomainEventType

`packages/core/src/events/domain_event_types.ts` — canonical const object that defines every event type string in the system.

```ts
import { DomainEventType } from "@exaix/core/events";

await this.logger.info(DomainEventType.ExecutionStarted, traceId, payload);
```

Never use an inline string literal where a `DomainEventType` member exists. The full table of members is in `docs/Reference_Data.md#event-taxonomy`.

### EventRegistry

`packages/core/src/events/event_registry.ts` — validates event sources at emission time. Every publisher must register before its first `emit()` call.

```ts
import { DomainEventType, EventRegistry } from "@exaix/core/events";

// At bootstrap — once per process lifetime
registry.registerPublisher("execution_loop", [
  DomainEventType.ExecutionStarted,
  DomainEventType.ExecutionCompleted,
  DomainEventType.ExecutionFailed,
]);

// At emission site
await registry.emit("execution_loop", DomainEventType.ExecutionStarted, { traceId });
```

`emit()` throws if the sourceId is not registered or the event type is not in its registered set. After validation it delegates to `IEventLogger.info()` — no new delivery path.

Use `registry.registeredPublishers()` in integration tests to assert the expected publisher set.

---

## EventLogger Output Configuration

`EventLogger` supports pluggable output sinks via `IEventLoggerConfig.outputs`. Three built-in implementations are available from `@exaix/core/logger`:

| Class                 | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `_ConsoleOutput`      | Rich console formatting with timestamps, level tags, and context |
| `_RotatingFileOutput` | Size-based JSON log rotation to `.exa/logs/`                     |
| `_ObservableOutput`   | In-process subscriber support for TUI and SSE consumers          |

These are internal classes (prefixed `_`) not re-exported from the barrel. Wire them at bootstrap through `IEventLoggerConfig.outputs`:

```ts
import { EventLogger, type IEventLoggerOutput } from "@exaix/core/logger";

const logger = new EventLogger({
  activityRepo,
  eventBus,
  outputs: [myCustomOutput], // implements IEventLoggerOutput
});
```

`IEventLoggerOutput` has a single method:

```ts
interface IEventLoggerOutput {
  write(event: ILogEvent): void | Promise<void>;
}
```

Each output receives the fully enriched `ILogEvent` after the standard console write and DB persist. Outputs run sequentially; errors in an output are caught and logged to `console.error` without blocking the primary delivery path.
