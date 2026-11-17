# Routing

Inspect dynamic agent-role selection and routing policies. Part of the [Exaix User Guide](README.md).

## Preview and validate routing

Routing decides which agent role handles a request. A routing policy holds the rules, and Exaix ranks the candidate roles against them. Preview the choice before you run the request, and validate a policy file before you rely on it. Every option is in the generated [model reference](../cli/model.md#exactl-model-route-explain).

To preview the choice for a request, run `exactl model route explain --request <request-file>`. The command reads the frontmatter of the request and the policy rules, and it creates no plan. It prints the selected agent role and version, the matched rule, the routing strategy and the scores of the top candidates.

To check a policy, run `exactl model route validate <policy-file>`. The command checks the YAML file against the current schema and the rule semantics. Without a path, it validates the configured default routing policy.

Tips:

- Run `explain` after each edit of a policy, with a request that you expect to match a specific rule.
- Run `validate` in a script before you deploy a policy. A failed validation ends with exit code 6.
