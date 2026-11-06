# Project facts

case_id: p234-s5-c3
Update an existing requirements record after a newly accepted storage decision.
Earlier assumption A-local-delete: audit events are local files that the application can delete.
Earlier criterion AC-local-purge: physically delete local audit files after 30 days.
New accepted decision D-storage: use an external immutable archive that rejects deletion.
D-storage is already recorded in ADR-007; do not reopen it or create another ADR.
There is no decision yet on whether logical expiry can replace physical deletion.
Show which earlier assumptions and criteria this storage decision invalidates.
Do not retain contradictory requirements as resolved or invent a physical deletion capability.
