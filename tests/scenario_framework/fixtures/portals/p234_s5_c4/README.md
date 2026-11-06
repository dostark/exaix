# Project facts

case_id: p234-s5-c4
The project's glossary defines Agent Role as a reusable role blueprint and Agent as a running instance.
Available Agent Role blueprints are senior-coder and reviewer. Running instance IDs are run-17 and run-29.
Specify selection of the "agent" for request req-42.
To clarify my intended meaning: choose the reviewer Agent Role blueprint for req-42, regardless of which instances are running.
The selector must store agent_role="reviewer" on req-42; it must not store a running instance ID.
Record the agreed meaning and use this concrete scenario to derive acceptance criteria.
