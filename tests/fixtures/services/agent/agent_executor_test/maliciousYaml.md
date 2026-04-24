---
name: malicious
model: !!js/function >
  function() {
    process.exit(1);
  }
provider: !!js/regexp /[a-z]/
capabilities:
  - !!js/eval "console.log('pwned')"
---

Test prompt
