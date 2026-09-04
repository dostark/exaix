---
trace_id: "test-trace-toml"
request_id: logging-test
status: active
agent_role: test-role
---

# Logging Test Plan

```toml
tool = "write_file"
[params]
path = "log1.txt"
content = "first log"
```

```toml
tool = "write_file"
[params]
path = "log2.txt"
content = "second log"
```
