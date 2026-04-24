---
trace_id: "test-trace-notool"
request_id: no-tool-field
status: active
---

# Plan with Non-Action Code Blocks

```toml
tool = "write_file"
[params]
path = "valid.txt"
content = "valid action"
```

```toml
[params]
path = "ignored.txt"
content = "missing tool"
```
