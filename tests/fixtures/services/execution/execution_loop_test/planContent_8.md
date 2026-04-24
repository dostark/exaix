---
trace_id: "test-trace-malformed"
request_id: multi-actions
status: active
---

# Test Plan with Multiple TOML Actions

```toml
tool = "write_file"
[params]
path = "valid.txt"
content = "valid action"
```

```toml
invalid = "not an action"
```
