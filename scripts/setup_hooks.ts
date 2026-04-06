/**
 * @module setup_hooks
 * @description Script: setup_hooks
 */
import { join } from "https://deno.land/std@0.221.0/path/mod.ts";

/**
 * setup_hooks.ts
 * Automates the installation of git hooks for Exaix.
 */

const REPO_ROOT = Deno.cwd();
const HOOKS_DIR = join(REPO_ROOT, ".git", "hooks");

const PRE_COMMIT_CONTENT = `#!/bin/sh
# Exaix Pre-commit Hook
echo "\n🔍 Running Pre-commit Gates..."

# 1. Format Check
deno task fmt:check
if [ $? -ne 0 ]; then
  echo "❌ Error: Formatting issues found. Run 'deno task fmt' to fix."
  exit 1
fi

# 2. Linting
deno task lint
if [ $? -ne 0 ]; then
  echo "❌ Error: Linting failed."
  exit 1
fi

# 3. Style/Boundary Check
deno task check:style
if [ $? -ne 0 ]; then
  echo "❌ Error: Code style/boundary validation failed."
  exit 1
fi

# 4. Magic Values Check
deno task check:magic
if [ $? -ne 0 ]; then
  echo "❌ Error: Magic value validation failed."
  exit 1
fi

# 5. Docs Drift Check
deno task check:docs
if [ $? -ne 0 ]; then
  echo "❌ Error: Documentation manifest is out of date. Run 'deno run -A scripts/verify_manifest_fresh.ts' to update."
  exit 1
fi

# 6. Markdown Lint (only when staged markdown files changed)
STAGED_MD_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.md$' || true)
if [ -n "$STAGED_MD_FILES" ]; then
  echo "📝 Markdown files changed; running markdown lint..."
  printf '%s\n' "$STAGED_MD_FILES" | xargs deno run --allow-read scripts/markdown_lint.ts
  if [ $? -ne 0 ]; then
    echo "❌ Error: Markdown lint failed."
    exit 1
  fi
fi

# 7. Complexity Check
deno task check:complexity
if [ $? -ne 0 ]; then
  echo "❌ Error: Code complexity exceeds threshold. Please refactor complex functions."
  exit 1
fi

# 8. Architecture Check
deno task check:arch
if [ $? -ne 0 ]; then
  echo "❌ Error: Architecture validation failed."
  exit 1
fi

# 9. Agent-Native Documentation Nervous System Check
deno task docs-agent-validate
if [ $? -ne 0 ]; then
  echo "❌ Error: Documentation nervous system validation failed (links/symbols)."
  exit 1
fi

# 10. Hallucination Benchmarks (Ground Truth)
deno task docs-bench
if [ $? -ne 0 ]; then
  echo "❌ Error: Hallucination benchmarks failed. Verify ground truth consistency."
  exit 1
fi

echo "✅ Pre-commit checks passed!\n"
`;

const PRE_PUSH_CONTENT = `#!/bin/sh
# Exaix Pre-push Hook
echo "\n🚀 Running Pre-push Gates..."

# 1. Type Check
deno task check
if [ $? -ne 0 ]; then
  echo "❌ Error: Type checking failed."
  exit 1
fi

# 2. Security Tests
deno task test:security
if [ $? -ne 0 ]; then
  echo "❌ Error: Security regression tests failed."
  exit 1
fi

echo "✅ Pre-push checks passed!\n"
`;

const COMMIT_MSG_CONTENT = `#!/bin/sh
# Exaix Commit-msg Hook
echo "\n🔍 Validating Commit Message Structure..."

# Run the validation script pointing to the commit message file
deno task check-commit-msg "$1"
if [ $? -ne 0 ]; then
  echo "❌ Error: Invalid commit message format. Commit blocked."
  exit 1
fi

echo "✅ Commit message valid!\n"
`;

async function installHooks() {
  console.log("🛠️ Installing Exaix Git Hooks...");

  try {
    const stats = await Deno.stat(HOOKS_DIR);
    if (!stats.isDirectory) {
      console.error("❌ Error: .git/hooks directory not found. Are you in a git repository?");
      Deno.exit(1);
    }
  } catch (_e) {
    console.error("❌ Error: .git/hooks directory not found. Are you in a git repository?");
    Deno.exit(1);
  }

  const preCommitPath = join(HOOKS_DIR, "pre-commit");
  const prePushPath = join(HOOKS_DIR, "pre-push");
  const commitMsgPath = join(HOOKS_DIR, "commit-msg");

  await Deno.writeTextFile(preCommitPath, PRE_COMMIT_CONTENT);
  await Deno.writeTextFile(prePushPath, PRE_PUSH_CONTENT);
  await Deno.writeTextFile(commitMsgPath, COMMIT_MSG_CONTENT);

  // Make them executable
  if (Deno.build.os !== "windows") {
    await Deno.chmod(preCommitPath, 0o755);
    await Deno.chmod(prePushPath, 0o755);
    await Deno.chmod(commitMsgPath, 0o755);
  }

  console.log("✅ Hooks installed successfully in .git/hooks/");
  console.log(
    "   - pre-commit: fmt, lint, style/boundary, magic values, docs drift, markdown lint (staged .md only), complexity, architecture",
  );
  console.log("   - pre-push: type-check, security tests");
  console.log("   - commit-msg: structured commit message validation");
}

if (import.meta.main) {
  await installHooks();
}
