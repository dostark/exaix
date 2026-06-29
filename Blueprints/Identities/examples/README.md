# Exaix Agent Examples

This directory contains comprehensive example identity blueprints demonstrating real-world patterns and capabilities for Exaix. These examples serve as templates and starting points for creating custom agents.

## 📁 Directory Structure

````text
Blueprints/Identities/examples/
├── README.md                           # This file
├── code-reviewer.md                    # Code quality and security review
├── feature-developer.md                # End-to-end feature implementation
├── api-documenter.md                   # API documentation generation
├── security-auditor.md                 # Security vulnerability assessment
└── research-synthesizer.md             # Research analysis and synthesis

Blueprints/Identities/templates/
├── pipeline-agent.md.template          # Template for systematic processing
└── collaborative-agent.md.template     # Template for multi-agent workflows
```text

## ⚠️ Prerequisites

These examples are **reference implementations**. They demonstrate best practices for system prompts, capabilities, and persona definitions.

**To use an example agent:**

1. **Copy it** to the parent directory (`Blueprints/Identities/`).

1.

## 🤖 Example Agents

### Development Agents

| Agent                 | Purpose                                           | Capabilities                                         |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| **code-reviewer**     | Code quality, security, and best practices review | `read_file`, `write_file`, `list_directory`          |
| **feature-developer** | Complete feature implementation lifecycle         | `read_file`, `write_file`, `list_directory`, `git_*` |

### Content Agents

| Agent              | Purpose                                      | Capabilities                  |
| ------------------ | -------------------------------------------- | ----------------------------- |
| **api-documenter** | API documentation generation and maintenance | `read_file`, `list_directory` |

### Analysis Agents

| Agent                    | Purpose                                        | Capabilities                                |
| ------------------------ | ---------------------------------------------- | ------------------------------------------- |
| **security-auditor**     | Security vulnerability scanning and assessment | `read_file`, `list_directory`, `git_status` |
| **research-synthesizer** | Multi-source research analysis and synthesis   | `read_file`, `write_file`, `list_directory` |

## 📋 Identity Blueprint Format

All identity blueprints use YAML frontmatter with the following structure:

```yaml
---
identity_id: "agent-identifier"
name: "Agent Display Name"
model: "provider:model-name"
capabilities: ["tool1", "tool2", "tool3"]
created: "2026-01-05T00:00:00Z"
created_by: "author"
version: "1.0.0"
description: "Brief description"
default_skills: ["skill-1", "skill-2"]  # Phase 17 skills integration
---

# Agent Title

Agent description and usage examples...

## System Prompt

Detailed system prompt for the agent...

## Usage Examples

- Example use case 1
- Example use case 2

## Capabilities Required

- `tool1`: Description of why this tool is needed
- `tool2`: Description of why this tool is needed

## Shared Fragments

Example blueprints are standardized using shared fragments from `Blueprints/Fragments/`.
Always use `default_skills` (including `response-contract`) to ensure the agent outputs valid, executable plans.
```text

## 🛠️ Available MCP Tools

Agents can use the following MCP (Model Context Protocol) tools:

### File Operations

- `read_file`: Read files from portals
- `write_file`: Write files to portals
- `list_directory`: List directory contents

### Git Operations

- `git_create_branch`: Create feature branches
- `git_commit`: Commit changes
- `git_status`: Check git status

## 🔐 Portal Permissions

Agents can only access portals that:

1. List the agent in `agents_allowed` (or use `"*"` for all agents)

1.

## 📝 Creating Custom Agents

### Using Examples as Templates

1. Copy an example agent that matches your use case

1.
1.

### Using Templates

For specialized patterns:

- **Pipeline Template**: For systematic, step-by-step processing
- **Collaborative Template**: For multi-agent workflow integration

Replace `{agent_name}`, `{model_name}`, `{specialty}`, etc. with your specific values.

## 🧪 Testing Agents

Each agent should be tested for:

1. **Blueprint Loading**: Validates against schema

1.
1.

See `agents/workflows/testing.md` for comprehensive testing guidelines.

## 🚀 Getting Started

1. Review the example agents that match your use case

1.
1.
1.

## 📚 Related Documentation

- `docs/Exaix_Implementation_Plan.md` - Step 6.10: Agent Examples
- `agents/workflows/exaix-development.md` - Blueprint creation guidelines
- `agents/workflows/testing.md` - Testing guidelines
- `Blueprints/Flows/examples/` - Flow examples that use these agents
````
