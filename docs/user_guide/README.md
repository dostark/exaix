# Exaix User Guide

How to deploy and use an Exaix workspace. The guide is split by topic, and each file is short enough to read in one sitting. Start with the path that fits you.

## Reading paths

- **New to Exaix:** [Getting Started](getting-started.md), then [CLI Basics](cli-basics.md), then [Requests, Plans and Reviews](requests-plans-reviews.md).
- **Working on a project:** [Portals](portals.md), [Blueprints and Flows](blueprints-and-flows.md), [Flow Authoring](flow-authoring.md), [Skills](skills.md), [Workspace and Memory](workspace-and-memory.md) and [Memory](memory.md).
- **Running the daemon:** [Operations](operations.md), [Monitoring and Logs](monitoring.md), [Cost Tracking](cost-tracking.md) and [Security and Safety](security-and-safety.md).
- **Configuring models and tools:** [Model Settings](model-settings.md), [Model Resolution](model-resolution.md), [Configuration](configuration.md) and [Tool Guidance](tool-guidance.md).

## All topics

| Topic                                                    | What it covers                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [Getting Started](getting-started.md)                    | What Exaix is, key concepts, deploying a workspace, local model setup and first requests.                                 |
| [CLI Basics](cli-basics.md)                              | Installing exactl, the command grammar, global options, exit codes, confirmations, output formats and a quick reference.  |
| [TUI Dashboard](tui-dashboard.md)                        | The terminal dashboard and its views.                                                                                     |
| [TUI Keyboard Reference](tui-keyboard-reference.md)      | Every key of every dashboard view, split panes and layouts.                                                               |
| [Requests, Plans and Reviews](requests-plans-reviews.md) | Create requests, clarify them, approve plans, review agent output and inspect git history.                                |
| [Portals](portals.md)                                    | Add external projects as portals and work on them with agents.                                                            |
| [Blueprints and Flows](blueprints-and-flows.md)          | Agent role blueprints, the flow commands, step execution and scaffolding.                                                 |
| [Flow Authoring](flow-authoring.md)                      | Write a flow: step types, gates, retry loops, branches, capability requirements, voting steps and the shipped blueprints. |
| [Routing](routing.md)                                    | Inspect dynamic agent-role selection and routing policies.                                                                |
| [Skills](skills.md)                                      | Procedural skills: format, matching, lifecycle and commands.                                                              |
| [Workspace and Memory](workspace-and-memory.md)          | The workspace layout, memory banks and the file formats of the workspace.                                                 |
| [Memory](memory.md)                                      | How Exaix remembers: the memory lifecycle, the self-learning loop, settings and fallbacks.                                |
| [Session Delegation](session-delegation.md)              | Delegate code changes to a CLI tool and run steps through a CLI delegate.                                                 |
| [Agent Features](agent-features.md)                      | Reflexion, model intent flags, confidence scoring, session memory, retry and structured output.                           |
| [Configuration](configuration.md)                        | Configuration areas, execution settings and the config commands.                                                          |
| [Model Settings](model-settings.md)                      | Every provider, service, transport and model setting, and the variables that set them.                                    |
| [Model Resolution](model-resolution.md)                  | How Exaix picks a provider and model for a request, and how to read the result.                                           |
| [Tool Guidance](tool-guidance.md)                        | ACI tool guidance, read-only planning tools and parallel tool calls.                                                      |
| [MCP Server](mcp.md)                                     | The MCP server, its tools, client integration and outbound tool calls.                                                    |
| [Security and Safety](security-and-safety.md)            | Security features, the network allowlist, plan amendments, approvals and human-in-the-loop governance.                    |
| [Operations](operations.md)                              | Backup, restore, upgrade, troubleshooting, uninstall, daemon control and health checks.                                   |
| [Monitoring and Logs](monitoring.md)                     | The activity journal, log queries, live watch and OpenTelemetry export.                                                   |
| [Cost Tracking](cost-tracking.md)                        | Cost tracking, budgets and supported providers.                                                                           |
| [Evaluation](evaluation.md)                              | Run evaluation scenarios, read the history and compare runs.                                                              |

## Related documents

- [CLI reference](../cli/index.md): every `exactl` command with its options, examples and exit codes, generated from the code.
- [Evaluation Framework guide](../evaluation-framework.md) and [Dogfooding guide](../Exaix_Dogfooding.md): the contributor guides for scenario evaluation and for developing Exaix with Exaix.
