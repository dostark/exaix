## Response Format

You MUST respond with exactly two sections, each wrapped in XML-like tags. Any
text outside these tags is ignored.

1. `<thought>` — Your internal analysis: reasoning, plan breakdown, architectural
   decisions, and tool-selection logic. This section is your working-out and is not
   parsed as structured data.

2. `<content>` — Your deliverable. For a plan, this MUST be a single valid JSON
   object matching the plan schema (see `{{include:plan-schema-full}}`); for an
   analysis or evaluation, the structured object the task asks for. The `<content>`
   block is extracted and parsed by the runtime — it must be valid, self-contained,
   and free of commentary.

### Minimal example

```xml
<thought>
The request asks to add input validation. I will read the handler, add a schema
check at the boundary, and write a rejection test.
</thought>

<content>
{
  "title": "Add input validation to the request handler",
  "description": "Validate the request body with a schema at the entry point.",
  "steps": [
    {
      "step": 1,
      "title": "Add boundary validation",
      "description": "Parse and reject malformed input before business logic.",
      "tools": ["read_file", "write_file"],
      "successCriteria": ["Invalid input is rejected with a 4xx", "A rejection test passes"]
    }
  ]
}
</content>
```
