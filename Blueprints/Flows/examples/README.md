# Exaix Flow Examples

This directory contains comprehensive examples demonstrating Exaix's multi-agent flow orchestration capabilities. These examples serve as both learning resources and practical templates for building complex workflows.

## Overview

Exaix flows enable sophisticated multi-agent orchestration with support for:

- **Pipeline execution** - Sequential processing with data transformation
- **Parallel execution** - Concurrent processing with synchronization
- **Fan-out/Fan-in patterns** - Distribute work and aggregate results
- **Staged workflows** - Multi-phase processes with dependencies
- **Error handling** - Retry logic and failure recovery

## ⚠️ Prerequisites

These examples are **reference implementations**. They often use specialized agents (e.g., `security-reviewer`, `performance-reviewer`) that may not exist in your workspace by default.

**Before running an example:**

1. **Check the code:** Open the `.flow.yaml` file and look for the `agent:` fields.

1.

## Example Categories

### 🔧 Development Workflows

Code quality assurance, feature development, and software engineering processes.

- **[Code Review Flow](development/code_review.flow.yaml)** - Multi-stage code review with linting, security, and peer review
- **[Feature Development Flow](development/feature_development.flow.yaml)** - End-to-end feature development from requirements to documentation
- **[Refactoring Flow](development/refactoring.flow.yaml)** - Safe code refactoring with testing and validation

### 📝 Content Creation

Documentation, technical writing, and content generation workflows.

- **[API Documentation Flow](content/api_documentation.flow.yaml)** - Automated API documentation generation
- **[Technical Writing Flow](content/technical_writing.flow.yaml)** - Structured technical content creation
- **[Research Synthesis Flow](content/research_synthesis.flow.yaml)** - Multi-perspective research with synthesis

### 🔍 Analysis & Assessment

Code analysis, security audits, and performance evaluations.

- **[Security Audit Flow](analysis/security_audit.flow.yaml)** - Comprehensive security assessment
- **[Performance Review Flow](analysis/performance_review.flow.yaml)** - Application performance analysis
- **[Code Analysis Flow](analysis/code_analysis.flow.yaml)** - Comprehensive codebase analysis

### ⚙️ Operations & Maintenance

System administration, deployment, and operational workflows.

- **[Deployment Flow](operations/deployment.flow.yaml)** - Safe application deployment
- **[Monitoring Setup Flow](operations/monitoring.flow.yaml)** - System monitoring configuration
- **[Incident Response Flow](operations/incident_response.flow.yaml)** - Automated incident handling

## Flow Patterns Demonstrated

### Pipeline Pattern

```typescript
// Sequential processing with data transformation
const pipelineFlow = defineFlow({
  steps: [
    { id: "step1", dependsOn: [] /* ... */ },
    { id: "step2", dependsOn: ["step1"] /* ... */ },
    { id: "step3", dependsOn: ["step2"] /* ... */ },
  ],
});
```

### Fan-out/Fan-in Pattern

```typescript
// Parallel processing with aggregation
const parallelFlow = defineFlow({
  steps: [
    { id: "worker1", dependsOn: [] /* ... */ },
    { id: "worker2", dependsOn: [] /* ... */ },
    { id: "worker3", dependsOn: [] /* ... */ },
    { id: "aggregator", dependsOn: ["worker1", "worker2", "worker3"] /* ... */ },
  ],
});
```

### Staged Pattern

```typescript
// Multi-phase workflow
const stagedFlow = defineFlow({
  steps: [
    // Stage 1
    { id: "stage1-task1", dependsOn: [] /* ... */ },
    { id: "stage1-task2", dependsOn: [] /* ... */ },

    // Stage 2 (depends on stage 1 completion)
    { id: "stage2-task1", dependsOn: ["stage1-task1", "stage1-task2"] /* ... */ },
    { id: "stage2-task2", dependsOn: ["stage1-task1", "stage1-task2"] /* ... */ },
  ],
});
```

## Getting Started

### Running an Example Flow

1. **List available flows:**

   ```bash
   exactl flow list
   ```

1.

```bash
exactl flow run --id code-review --request "Please review this TypeScript code for best practices..."
```

1.

```bash
exactl flow validate Blueprints/Flows/examples/development/code_review.flow.yaml
```

### Using as Templates

1. **Copy an example:**

   ```bash
   cp Blueprints/Flows/examples/development/code_review.flow.yaml my_custom_flow.flow.yaml
   ```

1.
   - Update agent names to match your configured agents
   - Adjust step dependencies and data transformations
   - Customize retry logic and timeouts

1.

```bash
exactl flow validate my_custom_flow.flow.yaml
exactl flow run --file my_custom_flow.flow.yaml --request "Your request here..."
```

## Flow Configuration

### Input Sources

- `"request"` - Use the original user request
- `"step"` - Use output from a specific previous step
- `"aggregate"` - Combine outputs from multiple previous steps

### Data Transformations

- `"passthrough"` - Use data unchanged
- `"extract_code"` - Extract code blocks from input
- `"merge_as_context"` - Combine multiple inputs as context
- Custom transforms can be defined in `packages/flow/src/transforms.ts`

### Execution Settings

- `maxParallelism` - Maximum concurrent steps (default: 3)
- `failFast` - Stop on first failure (default: true)
- `timeout` - Flow-level timeout in milliseconds

## Best Practices

### Flow Design

1. **Keep flows focused** - Each flow should solve one specific problem
1. **Use meaningful step IDs** - Choose descriptive, action-oriented names
1. **Handle errors gracefully** - Configure appropriate retry logic
1. **Document complex logic** - Add comments for non-obvious transformations

### Agent Selection

1. **Match agent capabilities** - Choose agents suited to each step's requirements
1. **Consider execution time** - Some agents may be slower but more thorough
1. **Balance cost and quality** - Different agents may have different cost profiles

### Testing & Validation

1. **Validate before running** - Always check flows with `exactl flow validate`
1. **Test with sample data** - Use realistic test inputs
1. **Monitor execution** - Check activity logs for debugging
1. **Review generated reports** - Use FlowReporter output for analysis

## Integration with FlowReporter

All example flows automatically generate detailed execution reports when run, including:

- Step-by-step execution details
- Performance metrics and timing
- Dependency graphs (Mermaid format)
- Success/failure analysis
- Dataview-compatible metadata for optional Obsidian integration

Reports are saved to `Memory/Reports/` with filenames like:
`flow_code-review_run-abc123_2025-12-20T10-30-00.md`

## Contributing

When adding new examples:

1. Follow the established directory structure

1.
1.
1.
1.

## Troubleshooting

### Common Issues

**Flow validation fails:**

- Check that all step dependencies exist
- Verify agent names match configured agents
- Ensure input sources and transforms are valid

**Execution hangs:**

- Check for circular dependencies
- Verify agents are properly configured
- Review timeout settings

**Unexpected results:**

- Examine FlowReporter output for step details
- Check activity logs for execution traces
- Validate input data and transformations

### Getting Help

- Check the [Exaix Documentation](../../docs/) for detailed guides
- Review [FlowRunner Implementation](../../packages/flow/src/) for technical details
- Examine [Test Cases](../../tests/flows/) for usage examples
