---
trace_id: "test-trace-unknown"
request_id: any-test
status: active
identity_id: test-identity
---

# Unknown Tool Test

```toml
tool = "non_existent_tool"
[params]
path = "should-fail.txt"
content = "this should fail"
```
