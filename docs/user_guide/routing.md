# Routing

Inspect dynamic agent-role selection and routing policies. Part of the [Exaix User Guide](README.md).

## Routing Commands — Inspect dynamic agent-role selection

Use routing commands to preview how Exaix will choose an agent role before executing a request, and to validate routing policy syntax and semantics.

```bash
# Preview routing candidate ranking for a request file
exactl model route explain --request ./Workspace/Requests/my-request.md

# Validate a routing policy file
exactl model route validate ./routing.policy.yaml

# Validate the configured default routing policy
exactl model route validate
```

`exactl model route explain` evaluates the request frontmatter and policy rules without creating a plan. It prints the selected agent role/version, matched rule, routing strategy, and top candidate scores.

`exactl model route validate` checks a YAML policy file against the current schema. When omitted, it validates the configured default routing policy file.
