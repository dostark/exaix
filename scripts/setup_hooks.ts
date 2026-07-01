#!/usr/bin/env -S deno run -A
/**
 * @module SetupHooks
 * @path scripts/setup_hooks.ts
 * @description Configures Git hooks (like pre-commit) to run validations before commits.
 *
 * Usage:
 *   deno run -A scripts/setup_hooks.ts
 */
import { join } from "@std/path";

const REPO_ROOT = Deno.cwd();
const HOOKS_DIR = join(REPO_ROOT, ".git", "hooks");

const PRE_COMMIT_CONTENT = `#!/bin/sh
# ============================================
# Exaix Pre-commit Hook
# ============================================
# Gate 0: Block direct commits on 'main'
#         Bypass: HOOK_BYPASS_MAIN=1 git commit ...
# Gates 1-13: Format, lint, style, magic, docs, complexity, parity, arch, event-strings
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

# 3b. Edition-Leak Graph Gate (deno-info double-check of the [edition-leak] static rule)
deno task check:edition-graph
if [ $? -ne 0 ]; then
  echo "❌ Error: Edition-leak graph gate failed (a static higher-tier import reached the resolved graph)."
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

# 12. Tool Result Parity Check
deno task check:tool-result-parity
if [ $? -ne 0 ]; then
  echo "❌ Error: Tool result parity check failed. TOOL_MANIFEST is out of sync with handler schemas."
  exit 1
fi

# 13. Inline Event String Check
deno task check:event-strings
if [ $? -ne 0 ]; then
  echo "❌ Error: Inline event string literals detected. Use DomainEventType members instead."
  echo "    See CODE_STYLE.md#event-type-strings for guidance."
  exit 1
fi

# 14. Skill Envelope Validity (every .copilot/skills exaix: block must transform)
deno task check:skill-envelopes
if [ $? -ne 0 ]; then
  echo "❌ Error: A .copilot/skills exaix: block is invalid (would not load in the dogfood daemon)."
  exit 1
fi

# 14b. Runtime skill index in sync (Memory/Skills generated from Blueprints/Skills)
deno task check:skill-index
if [ $? -ne 0 ]; then
  echo "❌ Error: Memory/Skills is out of sync with Blueprints/Skills (run: deno task check:skill-index without --check, or regenerate)."
  exit 1
fi

# 14c. Blueprint catalog integrity (identities ↔ flows, skills ↔ identities all resolve)
deno task check:blueprint-integrity
if [ $? -ne 0 ]; then
  echo "❌ Error: Blueprint catalog has integrity violations (dangling or orphan identity/skill). See output above."
  exit 1
fi

# 15. Step Manifest Validity (every phase-NN step, NN >= 130, must have a valid manifest)
deno task check:manifests
if [ $? -ne 0 ]; then
  echo "❌ Error: A phase plan step is missing or has an invalid step-manifest."
  exit 1
fi

# 16. Stale Markdown Path Check (ratchet: only STAGED markdown files must resolve)
deno task check:md-path:staged
if [ $? -ne 0 ]; then
  echo "❌ Error: A staged markdown file references a filesystem path that does not resolve."
  echo "    Fix the path, or run: deno task check:md-path:fix (rewrites unambiguous link renames)."
  exit 1
fi

echo "✅ Pre-commit checks passed!\n"
`;

const PRE_PUSH_CONTENT = `#!/bin/sh
# ============================================
# Exaix Pre-push Hook
# ============================================
# Runs on \`git push\` to any remote.
# Ensures the codebase passes type checking and
# security regression tests before code leaves the local machine.
# ============================================

echo "
🚀 Running Pre-push Gates..."

# 1. Manifest Auto-Sync
#    Regenerate the documentation manifest before pushing code.
MANIFEST_BACKUP=$(mktemp)
cp .copilot/manifest.json "$MANIFEST_BACKUP" 2>/dev/null || true

echo "🔄 Regenerating .copilot/manifest.json before push..."
deno run --allow-read --allow-write scripts/build_agents_index.ts
if [ $? -ne 0 ]; then
  echo "❌ Error: Failed to regenerate .copilot/manifest.json."
  rm -f "$MANIFEST_BACKUP"
  exit 1
fi

MANIFEST_SUBSTANTIVE_CHANGED=$(deno eval '
const [beforePath, afterPath] = Deno.args;

function normalize(obj) {
  const copy = JSON.parse(JSON.stringify(obj));
  delete copy.generated_at;
  if (Array.isArray(copy.docs)) {
    copy.docs.sort((a, b) => String(a.path).localeCompare(String(b.path)));
    for (const doc of copy.docs) {
      if (Array.isArray(doc.chunks)) doc.chunks.sort();
    }
  }
  return copy;
}

let before = {};
try {
  before = JSON.parse(Deno.readTextFileSync(beforePath));
} catch {
  before = {};
}

const after = JSON.parse(Deno.readTextFileSync(afterPath));
const isSame = JSON.stringify(normalize(before)) === JSON.stringify(normalize(after));
console.log(isSame ? "0" : "1");
' "$MANIFEST_BACKUP" .copilot/manifest.json)

if [ "$MANIFEST_SUBSTANTIVE_CHANGED" = "0" ]; then
  if [ -f "$MANIFEST_BACKUP" ]; then
    mv "$MANIFEST_BACKUP" .copilot/manifest.json
  fi
  git restore --staged .copilot/manifest.json 2>/dev/null || true
  echo "ℹ️ Only .copilot/manifest.json generated_at changed; skipping amend."
else
  git add .copilot/manifest.json
  echo "🔁 .copilot/manifest.json changed; amending current commit to include the updated manifest..."
  git commit --amend --no-edit
  if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to amend the current commit with .copilot/manifest.json."
    rm -f "$MANIFEST_BACKUP"
    exit 1
  fi
fi

rm -f "$MANIFEST_BACKUP"

# 2. Submodule Safety Check
#    If the parent repo includes a changed exaix-dev-docs pointer, ensure
#    the submodule is committed and pushed before pushing the parent repo.
if [ -d "exaix-dev-docs/.git" ]; then
  SUBMODULE_CHANGED=0
  while read LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA; do
    if [ "$LOCAL_SHA" = "0000000000000000000000000000000000000000" ]; then
      continue
    fi

    if [ "$REMOTE_SHA" = "0000000000000000000000000000000000000000" ]; then
      CHANGED_SUBMODULE=$(git diff-tree --no-commit-id --name-only --submodule=log -r "$LOCAL_SHA" -- exaix-dev-docs 2>/dev/null || true)
    else
      CHANGED_SUBMODULE=$(git diff --name-only --submodule=log "$REMOTE_SHA".."$LOCAL_SHA" -- exaix-dev-docs 2>/dev/null || true)
    fi

    if [ -n "$CHANGED_SUBMODULE" ]; then
      SUBMODULE_CHANGED=1
      break
    fi
  done

  if [ "$SUBMODULE_CHANGED" -eq 1 ]; then
    echo "🔐 Detected exaix-dev-docs submodule pointer change in the parent repo."
    cd exaix-dev-docs || exit 1

    if [ -n "$(git status --porcelain)" ]; then
      echo "❌ exaix-dev-docs has uncommitted changes. Commit or stash them before pushing the parent repo."
      exit 1
    fi

    UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)
    if [ -z "$UPSTREAM" ]; then
      echo "❌ exaix-dev-docs has no upstream branch configured. Push it manually before pushing the parent repo."
      exit 1
    fi

    AHEAD_BEHIND=$(git rev-list --left-right --count "$UPSTREAM...HEAD" 2>/dev/null || echo "0 0")
    AHEAD=$(echo "$AHEAD_BEHIND" | awk '{print $1}')

    if [ "$AHEAD" -gt 0 ]; then
      echo "🔁 Pushing exaix-dev-docs submodule to its upstream branch ($UPSTREAM)..."
      git push
      if [ $? -ne 0 ]; then
        echo "❌ Failed to push exaix-dev-docs. Push the submodule first before pushing the parent repo."
        exit 1
      fi
    else
      echo "✅ exaix-dev-docs submodule is already pushed to upstream."
    fi

    cd - >/dev/null || exit 1
  fi
fi

# 3. Full Type Check (all source AND test files)
#    The pre-push hook checks all packages, apps, and tests.
#    This catches TS errors across the entire codebase.
deno check packages/ apps/ tests/
if [ $? -ne 0 ]; then
  echo "❌ Error: Type checking failed."
  exit 1
fi

# 4. Security Regression Tests (always run — small, fast, critical)
#    Run only the security-tagged regression suite, not the full test suite.
deno test --allow-all --filter "[security]" tests/
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
deno task check:commit-msg "$1"
if [ $? -ne 0 ]; then
  echo "❌ Error: Invalid commit message format. Commit blocked."
  exit 1
fi

echo "✅ Commit message valid!\n"
`;

const PRE_MERGE_COMMIT_CONTENT = `#!/bin/sh
# ============================================
# Exaix Pre-merge-commit Hook
# ============================================
# Regenerates .copilot/manifest.json before creating merge commits.
# ============================================

echo "
🔄 Running Pre-merge-commit hook..."

deno run --allow-read --allow-write scripts/build_agents_index.ts
if [ $? -ne 0 ]; then
  echo "❌ Error: Failed to regenerate .copilot/manifest.json for merge commit."
  exit 1
fi

git add .copilot/manifest.json

echo "✅ .copilot/manifest.json regenerated and staged for merge commit.\n"
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
  const preMergeCommitPath = join(HOOKS_DIR, "pre-merge-commit");
  const preRebasePath = join(HOOKS_DIR, "pre-rebase");

  await Deno.writeTextFile(preCommitPath, PRE_COMMIT_CONTENT);
  await Deno.writeTextFile(prePushPath, PRE_PUSH_CONTENT);
  await Deno.writeTextFile(commitMsgPath, COMMIT_MSG_CONTENT);
  await Deno.writeTextFile(preMergeCommitPath, PRE_MERGE_COMMIT_CONTENT);
  await Deno.writeTextFile(preRebasePath, PRE_REBASE_CONTENT);

  // Make them executable
  if (Deno.build.os !== "windows") {
    await Deno.chmod(preCommitPath, 0o755);
    await Deno.chmod(prePushPath, 0o755);
    await Deno.chmod(commitMsgPath, 0o755);
    await Deno.chmod(preMergeCommitPath, 0o755);
    await Deno.chmod(preRebasePath, 0o755);
  }

  console.log("✅ Hooks installed successfully in .git/hooks/");
  console.log(
    "   - pre-commit: Gate 0 (main branch guard) + fmt, lint, style/boundary, test placement, magic values, docs drift, markdown lint (staged .md only), complexity, architecture",
  );
  console.log("   - pre-push: regenerate .copilot/manifest.json, type-check, security tests");
  console.log("   - pre-merge-commit: regenerate .copilot/manifest.json for merge commits");
  console.log("   - commit-msg: structured commit message validation");
  console.log("   - pre-rebase: blocks rebase with dirty working tree");
}

if (import.meta.main) {
  await installHooks();
}
