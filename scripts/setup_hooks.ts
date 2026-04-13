/**
 * @module setup_hooks
 * @description Script: setup_hooks
 */
import { join } from "@std/path";

/**
 * setup_hooks.ts
 * Automates the installation of git hooks for Exaix.
 */

const REPO_ROOT = Deno.cwd();
const HOOKS_DIR = join(REPO_ROOT, ".git", "hooks");

const PRE_COMMIT_CONTENT = `#!/bin/sh
# ============================================
# Exaix Pre-commit Hook
# ============================================
# Gate 0: Block direct commits on 'main'
#         Bypass: HOOK_BYPASS_MAIN=1 git commit ...
# Gates 1-11: Format, lint, style, magic, docs, complexity, arch
# ============================================

# --- Gate 0: Main branch guard ---
if [ "\${HOOK_BYPASS_MAIN:-}" != "1" ]; then
  BRANCH=\$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
  if [ "$BRANCH" = "main" ]; then
    if [ ! -f ".git/MERGE_HEAD" ]; then
      echo "" >&2
      echo "⚠️  Pre-commit hook: Direct commits on 'main' are blocked." >&2
      echo "" >&2
      echo "Please create a feature branch instead:" >&2
      echo "" >&2
      echo "  git checkout -b <feature-branch> main" >&2
      echo "" >&2
      echo "If this is intentional, bypass with:" >&2
      echo "" >&2
      echo "  HOOK_BYPASS_MAIN=1 git commit -m \\"...\\"" >&2
      echo "" >&2
      exit 1
    fi
  fi
fi

echo "
🔍 Running Pre-commit Gates..."

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

# 4. Test Placement Check
deno task check:test-placement
if [ $? -ne 0 ]; then
  echo "❌ Error: Test placement validation failed."
  exit 1
fi

# 5. Magic Values Check
deno task check:magic
if [ $? -ne 0 ]; then
  echo "❌ Error: Magic value validation failed."
  exit 1
fi

# 6. Manifest Auto-Sync
# Regenerate manifest.json if any .copilot/ source changed, then stage it
# so it is always included automatically — no manual step required.
STAGED_COPILOT=$(git diff --cached --name-only --diff-filter=ACMRD | grep -E '^.copilot/' | grep -v 'manifest.json' || true)
if [ -n "$STAGED_COPILOT" ]; then
  echo "🔄 .copilot/ sources changed; regenerating manifest.json..."
  deno run --allow-read --allow-write scripts/build_agents_index.ts
  if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to regenerate .copilot/manifest.json."
    exit 1
  fi
  git add .copilot/manifest.json
fi

# Verify manifest is now consistent (covers the case where manifest was
# already staged with stale content but no .copilot/ sources were staged)
deno task check:docs
if [ $? -ne 0 ]; then
  echo "❌ Error: Documentation manifest is still out of date after auto-sync."
  echo "    Run 'deno run -A scripts/build_agents_index.ts' and stage the result."
  exit 1
fi

# 7. Markdown Lint (only when staged markdown files changed)
STAGED_MD_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.md$' || true)
if [ -n "$STAGED_MD_FILES" ]; then
  echo "📝 Markdown files changed; running markdown lint..."
  printf '%s\n' "$STAGED_MD_FILES" | xargs deno run --allow-read scripts/markdown_lint.ts
  if [ $? -ne 0 ]; then
    echo "❌ Error: Markdown lint failed."
    exit 1
  fi
fi

# 8. Complexity Check
deno task check:complexity
if [ $? -ne 0 ]; then
  echo "❌ Error: Code complexity exceeds threshold. Please refactor complex functions."
  exit 1
fi

# 9. Architecture Check
deno task check:arch
if [ $? -ne 0 ]; then
  echo "❌ Error: Architecture validation failed."
  exit 1
fi

# 10. Agent-Native Documentation Nervous System Check
deno task docs-agent-validate
if [ $? -ne 0 ]; then
  echo "❌ Error: Documentation nervous system validation failed (links/symbols)."
  exit 1
fi

# 11. Hallucination Benchmarks (Ground Truth)
deno task docs-bench
if [ $? -ne 0 ]; then
  echo "❌ Error: Hallucination benchmarks failed. Verify ground truth consistency."
  exit 1
fi

echo "✅ Pre-commit checks passed!\n"
`;

const PRE_PUSH_CONTENT = `#!/bin/sh
# ============================================
# Exaix Pre-push Hook
# ============================================
# Runs on \`git push\` to any remote.
# Ensures the codebase passes type checking, focused tests, and
# security regression tests before code leaves the local machine.
# ============================================

echo "
🚀 Running Pre-push Gates..."

# 1. Full Type Check (all source AND test files)
#    The pre-commit hook only checks src/main.ts for speed.
#    Pre-push must catch TS errors in every file that will be pushed.
deno check src/ tests/
if [ $? -ne 0 ]; then
  echo "❌ Error: Type checking failed (src/ or tests/)."
  exit 1
fi

# 2. Focused Test Run — run tests for files that changed
#    If any test files were modified, run them.
#    If any source files were modified, run their mirrored test files.
CHANGED_FILES=$(git diff --name-only origin/main..HEAD 2>/dev/null || git diff --name-only HEAD~5..HEAD 2>/dev/null || echo "")
if [ -n "$CHANGED_FILES" ]; then
  TEST_FILES=""
  for f in $CHANGED_FILES; do
    case "$f" in
      src/*.ts)
        # Map src/foo/bar.ts → tests/foo/bar_test.ts
        test_path=$(echo "$f" | sed 's|^src/|tests/|; s|\\.ts$|_test.ts|')
        if [ -f "$test_path" ]; then
          TEST_FILES="$TEST_FILES $test_path"
        fi
        ;;
      tests/*.ts)
        TEST_FILES="$TEST_FILES $f"
        ;;
    esac
  done

  if [ -n "$TEST_FILES" ]; then
    echo "🧪 Running tests for changed files:$TEST_FILES"
    deno test --allow-all $TEST_FILES
    if [ $? -ne 0 ]; then
      echo "❌ Error: Focused tests failed for changed files."
      exit 1
    fi
  fi
fi

# 3. Security Regression Tests (always run — small, fast, critical)
deno task test:security
if [ $? -ne 0 ]; then
  echo "❌ Error: Security regression tests failed."
  exit 1
fi

echo "✅ Pre-push checks passed!
"
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

const PRE_REBASE_CONTENT = `#!/bin/sh
# Exaix Pre-rebase Guard
# Blocks rebase if the working tree is dirty to prevent data loss.
# Bypass: HOOK_BYPASS_REBASE=1 git rebase ...

if [ "\${HOOK_BYPASS_REBASE:-}" = "1" ]; then
  exit 0
fi

DIRTY=\$(git status --porcelain 2>/dev/null || echo "")

if [ -n "$DIRTY" ]; then
  echo "" >&2
  echo "⚠️  Pre-rebase hook: Uncommitted changes detected." >&2
  echo "" >&2
  echo "Rebasing with a dirty working tree can destroy uncommitted work." >&2
  echo "" >&2
  echo "Options:" >&2
  echo "" >&2
  echo "  1. Commit first (recommended):" >&2
  echo "     git add -A && git commit -m \\"WIP: <description>\\"" >&2
  echo "" >&2
  echo "  2. Stash first:" >&2
  echo "     git stash push -m \\"WIP: <description>\\"" >&2
  echo "" >&2
  echo "  3. Bypass (danger):" >&2
  echo "     HOOK_BYPASS_REBASE=1 git rebase <target>" >&2
  echo "" >&2
  echo "Changed files:" >&2
  echo "$DIRTY" >&2
  echo "" >&2
  exit 1
fi
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
  const preRebasePath = join(HOOKS_DIR, "pre-rebase");

  await Deno.writeTextFile(preCommitPath, PRE_COMMIT_CONTENT);
  await Deno.writeTextFile(prePushPath, PRE_PUSH_CONTENT);
  await Deno.writeTextFile(commitMsgPath, COMMIT_MSG_CONTENT);
  await Deno.writeTextFile(preRebasePath, PRE_REBASE_CONTENT);

  // Make them executable
  if (Deno.build.os !== "windows") {
    await Deno.chmod(preCommitPath, 0o755);
    await Deno.chmod(prePushPath, 0o755);
    await Deno.chmod(commitMsgPath, 0o755);
    await Deno.chmod(preRebasePath, 0o755);
  }

  console.log("✅ Hooks installed successfully in .git/hooks/");
  console.log(
    "   - pre-commit: Gate 0 (main branch guard) + fmt, lint, style/boundary, test placement, magic values, docs drift, markdown lint (staged .md only), complexity, architecture",
  );
  console.log("   - pre-push: type-check, security tests");
  console.log("   - commit-msg: structured commit message validation");
  console.log("   - pre-rebase: blocks rebase with dirty working tree");
}

if (import.meta.main) {
  await installHooks();
}
