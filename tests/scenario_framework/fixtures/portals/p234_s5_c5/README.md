# Project facts

case_id: p234-s5-c5
Record two approved project decisions and their acceptance criteria.
D-label: rename the reversible navigation label "Executions" to "Runs"; this does not change stored data or identifiers.
D-storage: use an authoritative immutable append-only ledger rather than the alternative embedded transactional database.
Both storage alternatives were considered. The chosen ledger supports requirement R-audit-independent:
an independent verifier must reconstruct the accepted event history without trusting the application's mutable database.
The ledger requires a derived read model and a costly historical-data migration; reversing this decision later would be costly.
The team normally uses the embedded database, so the reason for this exception would be surprising without context.
Keep ordinary decisions in the requirements record. If a tradeoff warrants an ADR, propose it with alternatives and rationale.
Do not create an ADR file or a glossary hierarchy. There is no unanswered choice to reopen.
