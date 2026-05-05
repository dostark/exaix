---
agent: general
scope: docs
title: "Update Building with AI Agents Documentation"
description: Add new patterns or learnings to the Building_with_AI_Agents.md knowledge base
short_summary: "Prompt template for adding new patterns and stories to Building_with_AI_Agents.md"
version: "0.2"
topics: ["documentation", "meta", "patterns", "field-guide"]
---

```text
Key points
- Target file: docs/Building_with_AI_Agents.md
- Parts are numbered sequentially — always run `git log` commands below to get accurate context
- Follow the established narrative voice: personal opening, technical body, pattern/meta-insight close
- After writing a new Part, rebuild the .copilot/ manifest so the doc index stays current

Canonical prompt (short):
"Add a new Part to docs/Building_with_AI_Agents.md covering: {topic/theme}.
Self-compute update context from the git log commands below, then follow content structure."

Self-computing context
  # Find the commit hash the file was last updated at
  git log --oneline --all -- docs/Building_with_AI_Agents.md | head -1

  # Find all commits since that hash
  git log <LAST_HASH>..HEAD --oneline

  # Count commits
  git log <LAST_HASH>..HEAD --oneline | wc -l

  # Find the next Part number
  grep -c "^## Part" docs/Building_with_AI_Agents.md

Content structure per Part
  1. Part title: "Part <N>: <Thematic Name> (<Month Year>)"
  2. Personal narrative opening — the problem, the wake-up call, the inflection point
  3. Technical details with concrete code examples and before/after comparisons
  4. Pattern recognition — what generalizable principle emerged
  5. Meta-insight or philosophical win — what this means for the project direction

After writing
  [ ] Run deno run --allow-read --allow-write scripts/build_agents_index.ts
      (to re-index docs/ in .copilot/manifest.json if summary changed)
  [ ] Run deno fmt docs/Building_with_AI_Agents.md

Do / Don't
- ✅ Do run the git log commands above first — never guess the Part number or last hash
- ✅ Do follow the established section structure (narrative → technical → pattern → meta)
- ✅ Do rebuild the manifest after writing if the file's summary changed
- ❌ Don't invent commit hashes or dates — compute them from git log
- ❌ Don't skip the meta-insight section — it is the most valuable part for future readers
```

## Prompt Template

```text
Add new content to docs/Building_with_AI_Agents.md documenting recent work.

First, self-compute update context:
  git log --oneline --all -- docs/Building_with_AI_Agents.md | head -1
  git log <LAST_HASH>..HEAD --oneline
  grep -c "^## Part" docs/Building_with_AI_Agents.md

Requirements:

1. Follow proper Part numbering (next available: compute with grep above)
2. Personal narrative opening — the problem or wake-up call
3. Technical details with code examples and before/after comparisons
4. Pattern recognition + meta-insight close

Content structure:

- Part title with thematic name and month/year
- Personal narrative opening (the problem, the wake-up call)
- Technical details with code examples
- Before/After comparisons
- Pattern recognition
- Meta-insights and philosophical wins

Update context (compute from git log above):

- Last updated: [computed]
- Commits since then: [computed]
- Focus areas: {agents/ enhancements / CI/CD / testing / etc.}

After writing:

1. Run: deno run --allow-read --allow-write scripts/build_agents_index.ts
2. Run: deno fmt docs/Building_with_AI_Agents.md
```

## Example Usage

**User:**

```text
Add new content to docs/Building_with_AI_Agents.md documenting recent work.

Requirements:

1. Follow proper Part numbering (next available: Part XVII)

1.
1.
1.

Content structure:

- Part title: "The Self-Documenting Agent System (January 2026)"
- Opening: The bootstrap problem (not using agents/ to enhance agents/)
- Technical details: Step 10.5 enhancements (claude.md, claude-rag.md, prompts/, cross-reference.md)
- Before/After: No templates → 8 copy-paste ready prompts
- Patterns: Documentation as a product, dual-interface system
- Meta-insight: Using agents/ to improve agents/ (the irony)

Update context:

- Last updated: b849adf (feat(ci): implement unified CI pipeline...)
- Commits since: 8cea321..HEAD (9 commits covering agents/ enhancements and CI/CD)
- Focus areas: agents/ prompts, RAG workflow, git hooks, multi-platform builds

After writing:

1. Rebuild agents infrastructure

   - RAG Context Injection
   - Inspect Embeddings
   - Agent Prompts Library
   - Git Hooks Setup
   - Local CI Gate
1.
   - For Agent Documentation Updates
   - For RAG Context Injection
   - For CI/CD and Quality Gates
   - For Commit Messages
```

**Expected Response:**

Claude should:

1. **Research phase**:

```bash
# Find last update
git log --oneline --all -- docs/Building_with_AI_Agents.md | head -1

# Get commits since then
git log b849adf..HEAD --oneline

# Read detailed commit messages
git log b849adf..HEAD --format="%H" | while read hash; do git show --stat $hash; done
```

1. **Content analysis**:
   - Review chat history for user's prompts and agent's responses
   - Identify patterns (e.g., "not following agents/ folder instructions")
   - Extract "wake-up call" moments (e.g., being called out for inconsistency)
   - Note technical implementations (prompt templates, RAG guide, git hooks)

1.

````markdown
## Part XVII: The Self-Documenting Agent System (January 2026)

### The Bootstrap Problem Revisited

Remember Part IX where we created the `agents/` directory? We had documentation
_for_ agents, but we were still treating it like regular docs—write it, forget it,
hope the AI reads it someday.

**The Wake-Up Call**:

\```
Me: [implements Step 10.5 enhancements to agents/ folder]
Me: [finishes implementation]
Me: [about to commit]
You: "You did not follow instructions in agents/ folder. Why?"
Me: ... 😳
\```

I had just enhanced the agents/ system to make it MORE useful... without using
the agents/ system to guide that enhancement. Peak irony.

[... continues with technical details, examples, before/after, patterns ...]
````

1.
   - Add rows to Essential Patterns table
   - Add new question templates
   - Maintain formatting consistency

1.

```bash
deno run --allow-read --allow-write scripts/build_agents_index.ts
deno run --allow-read scripts/validate_agents_docs.ts
```

## Style Guidelines

### ✅ Do

**Personal and Entertaining**:

```markdown
**The Wake-Up Call**:
I had just enhanced the agents/ system to make it MORE useful... without using
the agents/ system to guide that enhancement. Peak irony.
```

**Before/After with Concrete Examples**:

````markdown
**Before Step 10.5**:

- Agent docs existed but were hard to discover
- No clear workflow for using RAG
- Inconsistent prompting patterns

**After Step 10.5**:

- 19 agent docs (up from 11)
- 8 copy-paste prompt templates
- Cross-reference map for navigation

## Technical Details with Code**

**The Rebuild Workflow**:

```bash
# After any agents/ changes:
deno run --allow-read --allow-write scripts/build_agents_index.ts
deno run --allow-read scripts/validate_agents_docs.ts
```
````

**Meta-Insights**:

`````markdown
### The Meta-Learning: Documentation Is a Product

Treating documentation like code revolutionized quality:

- Schema validation (YAML frontmatter with Zod)
- Automated testing (12 tests for content structure)
- CI gates (can't merge broken docs)

### ❌ Don't

**Dry, Technical Documentation Style**:

````markdown
## agents/ Folder Enhancements

The agents/ folder was updated with the following improvements:

- Added claude.md version 0.2
- Created claude-rag.md with RAG workflow
- Added 8 prompt templates

**Missing Context or "Why"**:

```markdown
We added prompt templates to agents/prompts/. These include TDD workflow,
refactoring, and debugging templates.
```
````
`````

(Missing: Why were these needed? What problem did they solve? What was the wake-up call?)

**No Before/After Comparison**:

```markdown
The agents/ system now has cross-reference navigation.
```

(Missing: What was the pain before? How much better is it after? Concrete metrics?)

**Generic Advice**:

```markdown
Good documentation is important for project success.
```

(Missing: Exaix-specific examples, personal stories, actual impact)

## Key Patterns to Capture

When updating Building_with_AI_Agents.md, look for these patterns in recent work:

1. **Ironic Moments**: System designed to solve X fails at X (e.g., not using agents/ to improve agents/)

1.
1.
1.
1.
1.
1.
1.
1.

## Integration with Other Prompts

This prompt often follows:

- **implementation-plan-driven.md** — After completing a major Implementation Plan step
- **commit-message.md** — After creating detailed commits with rich context
- **refactoring-with-thinking.md** — After complex multi-step refactoring work

This prompt often precedes:

- **commit-message.md** — Commit the documentation update itself
- **rag-context-injection.md** — Use updated docs for future context injection

## Success Criteria

A good Building_with_AI_Agents.md update includes:

- ✅ Proper Part numbering (sequential, no gaps)
- ✅ Entertaining narrative style (personal, humorous, insightful)
- ✅ Technical accuracy (correct commands, file paths, test counts)
- ✅ Before/After comparisons (with metrics)
- ✅ Code examples (bash commands, file snippets, prompts)
- ✅ Pattern recognition (what's reusable beyond this specific case)
- ✅ Meta-insights (philosophical wins about AI-human collaboration)
- ✅ Updated reference sections (Essential Patterns, Question Templates)
- ✅ Rebuilt agents infrastructure (manifest, chunks, embeddings validated)
- ✅ Links to actual files (using relative paths like `../agents/prompts/`)

## See Also

- [agents/docs/documentation.md](../docs/documentation.md) — Documentation guidelines
- [implementation-plan-driven.md](implementation-plan-driven.md) — Working from Implementation Plan
- [commit-message.md](commit-message.md) — Creating detailed commits
- [Building_with_AI_Agents.md](../../docs/Building_with_AI_Agents.md) — The actual document
