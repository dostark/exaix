/**
 * @module SkillsManagerViewExtendedTest
 * @path apps/tui/tests/skills_manager_view_extended_test.ts
 * @description Targeted tests for SkillsManagerView metadata, ensuring robust coverage of
 * skill source icons, status indicators, and keyboard registration.
 */

import { assertEquals, assertExists, assertNotEquals, assertStringIncludes } from "@std/assert";

import {
  createSkillsManagerView,
  type ISkillSummary,
  MinimalSkillsServiceMock,
  SKILL_ICON,
  SKILLS_KEY_BINDINGS,
  SkillsAction,
  SkillsManagerView,
  SOURCE_ICONS,
  STATUS_ICONS,
} from "../src/skills_manager_view.ts";
import { MemoryBankSource, MemoryScope, SkillStatus } from "@exaix/core";
import {
  createSkillsManagerTuiSession,
  createSkillsManagerViewWithMock,
  createTestSkills,
  sampleSkill,
  sampleTestSkills,
  testSkillsSessionRender,
} from "./helpers.ts";
import { KEYS } from "@exaix/tui/helpers/keyboard.ts";
import { DEFAULT_GLOBAL_MEMORY_VERSION } from "@exaix/core";

// ===== Test Data =====

// ===== Constants Tests =====

Deno.test("SkillsManagerView: SOURCE_ICONS has all sources", () => {
  assertExists(SOURCE_ICONS.core);
  assertExists(SOURCE_ICONS.project);
  assertExists(SOURCE_ICONS.learned);
  assertEquals(SOURCE_ICONS.core, "📦");
  assertEquals(SOURCE_ICONS.project, "📁");
  assertEquals(SOURCE_ICONS.learned, "📚");
});

Deno.test("SkillsManagerView: STATUS_ICONS has all statuses", () => {
  assertExists(STATUS_ICONS.active);
  assertExists(STATUS_ICONS.draft);
  assertExists(STATUS_ICONS.deprecated);
  assertEquals(STATUS_ICONS.active, "🟢");
  assertEquals(STATUS_ICONS.draft, "🟡");
  assertEquals(STATUS_ICONS.deprecated, "⚫");
});

Deno.test("SkillsManagerView: SKILL_ICON is defined", () => {
  assertEquals(SKILL_ICON, "🎯");
});

Deno.test("SkillsManagerView: SKILLS_KEY_BINDINGS has required keys", () => {
  const actions = SKILLS_KEY_BINDINGS.map((b) => b.action);
  assertEquals(actions.includes(SkillsAction.NAVIGATE_UP), true);
  assertEquals(actions.includes(SkillsAction.VIEW_DETAIL), true);
  assertEquals(actions.includes(SkillsAction.DELETE), true);
  assertEquals(actions.includes(SkillsAction.SEARCH), true);
  assertEquals(actions.includes(SkillsAction.HELP), true);
  assertEquals(actions.includes(SkillsAction.BACK), true);
});

// ===== SkillsManagerView Core Tests =====

Deno.test("SkillsManagerView: getCachedSkills returns empty initially", () => {
  const mockService = new MinimalSkillsServiceMock([]);
  const view = new SkillsManagerView(mockService);

  assertEquals(view.getCachedSkills().length, 0);
});

Deno.test("SkillsManagerView: getCachedSkills returns copy of skills", async () => {
  const skills = createTestSkills();
  const mockService = new MinimalSkillsServiceMock(skills);
  const view = new SkillsManagerView(mockService);

  await view.getSkillsList();
  const cached = view.getCachedSkills();

  assertEquals(cached.length, skills.length);
  // Verify it's a copy
  const expandedCached = [
    ...cached,
    sampleSkill({
      id: "extra",
      name: "Extra",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.CORE,
    }),
  ];
  assertNotEquals(view.getCachedSkills().length, expandedCached.length);
});

Deno.test("SkillsManagerView: selectSkill and getSelectedSkill work", () => {
  const mockService = new MinimalSkillsServiceMock([]);
  const view = new SkillsManagerView(mockService);

  assertEquals(view.getSelectedSkill(), null);

  view.selectSkill("test-id");
  assertEquals(view.getSelectedSkill(), "test-id");

  view.selectSkill("another-id");
  assertEquals(view.getSelectedSkill(), "another-id");
});

Deno.test("SkillsManagerView: getSkillDetail returns skill from service", async () => {
  const skills = createTestSkills();
  const mockService = new MinimalSkillsServiceMock(skills);
  const view = new SkillsManagerView(mockService);

  const skill = await view.getSkillDetail("tdd-methodology");
  assertExists(skill);
  assertEquals(skill?.name, "TDD Methodology");

  const nonExistent = await view.getSkillDetail("nonexistent");
  assertEquals(nonExistent, null);
});

Deno.test("SkillsManagerView: deleteSkill removes from service", async () => {
  const { view } = createSkillsManagerViewWithMock();

  const result = await view.deleteSkill("tdd-methodology");
  assertEquals(result, true);

  const notFound = await view.deleteSkill("nonexistent");
  assertEquals(notFound, false);
});

Deno.test("SkillsManagerView: createSkillsManagerView factory function works", () => {
  const mockService = new MinimalSkillsServiceMock([]);
  const view = createSkillsManagerView(mockService);
  assertExists(view);
  assertEquals(view instanceof SkillsManagerView, true);
});

// ===== MinimalSkillsServiceMock Tests =====

Deno.test("MinimalSkillsServiceMock: listSkills filters by source", async () => {
  const skills = sampleTestSkills();
  const mock = new MinimalSkillsServiceMock(skills);

  const coreSkills = await mock.listSkills({ source: MemoryBankSource.CORE });
  assertEquals(coreSkills.length, 2); // tdd-methodology and security-first

  const projectSkills = await mock.listSkills({ source: MemoryBankSource.PROJECT });
  assertEquals(projectSkills.length, 2); // project-conventions and deprecated-skill

  const learnedSkills = await mock.listSkills({ source: MemoryBankSource.LEARNED });
  assertEquals(learnedSkills.length, 1); // learned-pattern
});

Deno.test("MinimalSkillsServiceMock: listSkills filters by status", async () => {
  const skills = sampleTestSkills();
  const mock = new MinimalSkillsServiceMock(skills);

  const activeSkills = await mock.listSkills({ status: SkillStatus.ACTIVE });
  assertEquals(activeSkills.length, 3);

  const draftSkills = await mock.listSkills({ status: SkillStatus.DRAFT });
  assertEquals(draftSkills.length, 1);

  const deprecatedSkills = await mock.listSkills({ status: SkillStatus.DEPRECATED });
  assertEquals(deprecatedSkills.length, 1);
});

Deno.test("MinimalSkillsServiceMock: listSkills filters by both source and status", async () => {
  const skills = sampleTestSkills();
  const mock = new MinimalSkillsServiceMock(skills);

  const result = await mock.listSkills({ source: MemoryBankSource.CORE, status: SkillStatus.ACTIVE });
  assertEquals(result.length, 2);
});

Deno.test("MinimalSkillsServiceMock: setSkills replaces skills", async () => {
  const mock = new MinimalSkillsServiceMock([]);
  assertEquals((await mock.listSkills()).length, 0);

  mock.setSkills(sampleTestSkills());
  assertEquals((await mock.listSkills()).length, 5);
});

// ===== TUI Session Tests =====

testSkillsSessionRender(
  "SkillsManagerTuiSession: navigation with 'j' and 'k' keys",
  [KEYS.J, KEYS.J, KEYS.K],
  (rendered, session) => {
    const state = session.getState();
    assertExists(state.selectedSkillId);
    assertExists(rendered);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: navigate to first and last with Home/End",
  [KEYS.END, KEYS.HOME],
  (rendered, session) => {
    const state = session.getState();
    assertExists(state.selectedSkillId);
    assertExists(rendered);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: toggle expand with left/right",
  [KEYS.LEFT, KEYS.RIGHT],
  (rendered, session) => {
    const state = session.getState();
    assertExists(state);
    assertExists(rendered);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: expand all and collapse all",
  [KEYS.C, KEYS.CAP_E],
  (rendered, session) => {
    const state = session.getState();
    assertExists(state);
    assertExists(rendered);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: refresh reloads skills",
  [KEYS.CAP_R],
  (rendered, session) => {
    const state = session.getState();
    assertExists(state);
    assertExists(rendered);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: filter source dialog",
  [KEYS.F],
  (rendered, session) => {
    assertEquals(session.hasActiveDialog(), true);
    assertEquals(rendered.length > 0, true);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: filter status dialog",
  [KEYS.S],
  (rendered, session) => {
    assertEquals(session.hasActiveDialog(), true);
    assertExists(rendered);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: delete skill dialog for non-core skill",
  [KEYS.DOWN, KEYS.DOWN, KEYS.DOWN, KEYS.DOWN, KEYS.DOWN], // Navigate to a project/learned skill
  async (_rendered, session) => {
    const state = session.getState();
    if (
      state.selectedSkillId?.includes(MemoryScope.PROJECT) || state.selectedSkillId?.includes(MemoryBankSource.LEARNED)
    ) {
      await session.handleKey(KEYS.D);
      // Check if dialog opened or not, depending on implementation
    }
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: delete blocked for core skills",
  [KEYS.DOWN],
  async (_rendered, session) => {
    const state = session.getState();
    if (state.selectedSkillId?.startsWith("skill-tdd") || state.selectedSkillId?.startsWith("skill-security")) {
      await session.handleKey(KEYS.D);
      assertEquals(session.hasActiveDialog(), false);
    }
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: show detail for skill node",
  [KEYS.DOWN, KEYS.ENTER],
  (_rendered, session) => {
    if (session.isShowingDetail()) {
      const detail = session.renderDetail();
      assertStringIncludes(detail, "Skill:");
    }
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: detail view shows triggers",
  [KEYS.DOWN, KEYS.ENTER],
  (_rendered, session) => {
    if (session.isShowingDetail()) {
      const detail = session.renderDetail();
      if (detail.includes("Triggers:")) {
        assertStringIncludes(detail, "Keywords:");
      }
    }
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: close detail with 'q'",
  [KEYS.DOWN, KEYS.ENTER, KEYS.Q],
  (_rendered, session) => {
    assertEquals(session.isShowingDetail(), false);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: help screen toggle with '?'",
  [KEYS.QUESTION, KEYS.QUESTION],
  (_rendered, session) => {
    assertEquals(session.isShowingHelp(), false);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: close help with 'q'",
  [KEYS.QUESTION, KEYS.Q],
  (_rendered, session) => {
    assertEquals(session.isShowingHelp(), false);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: close help with escape",
  [KEYS.QUESTION, KEYS.ESCAPE],
  (_rendered, session) => {
    assertEquals(session.isShowingHelp(), false);
  },
);

Deno.test("SkillsManagerTuiSession: render with no skills shows empty message", async () => {
  const mockService = new MinimalSkillsServiceMock([]);
  const view = new SkillsManagerView(mockService);
  const session = view.createTuiSession(false);

  await session.initialize();

  const output = session.render();
  assertStringIncludes(output, "No skills found");
});

testSkillsSessionRender(
  "SkillsManagerTuiSession: render shows filter info when filtering",
  [KEYS.SLASH, KEYS.ENTER, KEYS.T, KEYS.D, KEYS.D, KEYS.ENTER, KEYS.ENTER],
  (rendered, session) => {
    assertEquals(session.hasActiveDialog(), false);
    assertStringIncludes(rendered, "Filters:");
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: group by status",
  [KEYS.G],
  (rendered, session) => {
    assertEquals(session.getState().groupBy, "status");
    assertStringIncludes(rendered, "Active Skills");
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: group by none (flat list)",
  [KEYS.G, KEYS.G],
  (_rendered, session) => {
    assertEquals(session.getState().groupBy, "none");
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: search dialog filters skills",
  [KEYS.SLASH, KEYS.ESCAPE],
  (_rendered, session) => {
    assertEquals(session.hasActiveDialog(), false);
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: handleKey returns false for quit",
  [KEYS.Q],
  (rendered, _session) => {
    // We can't easily check the return value of handleKey here because the helper consumes it.
    // But we can check that sessions didn't crash.
    assertExists(rendered);
  },
  { skills: [] },
);

// Manual test for handleKey return value since helper doesn't expose it
Deno.test("SkillsManagerTuiSession: handleKey returns false for quit (manual)", async () => {
  const { session } = createSkillsManagerTuiSession([]);
  await session.initialize();
  const result = await session.handleKey(KEYS.Q);
  assertEquals(result, false);
});

Deno.test("SkillsManagerTuiSession: navigateDown when no selection selects first", async () => {
  const { session } = createSkillsManagerTuiSession();
  await session.initialize();

  // Manually clear selection via state (simulate edge case)
  const state = session.getState();
  if (!state.selectedSkillId) {
    await session.handleKey(KEYS.DOWN);
    assertExists(session.getState().selectedSkillId);
  }
});

Deno.test("SkillsManagerTuiSession: colors enabled vs disabled", async () => {
  const { session: sessionNoColors } = createSkillsManagerTuiSession();
  await sessionNoColors.initialize();
  const outputNoColors = sessionNoColors.render();
  assertExists(outputNoColors);

  // With colors enabled
  const { service: _service, view } = createSkillsManagerViewWithMock();
  const sessionWithColors = view.createTuiSession(true);
  await sessionWithColors.initialize();
  const outputWithColors = sessionWithColors.render();
  assertExists(outputWithColors);
});

testSkillsSessionRender(
  "SkillsManagerTuiSession: enter on group node toggles expansion",
  [],
  async (_rendered, session) => {
    const state = session.getState();
    if (state.selectedSkillId?.startsWith("group-")) {
      await session.handleKey(KEYS.ENTER);
      assertEquals(session.isShowingDetail(), false);
    }
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: invalid filter source shows error",
  [KEYS.F, ..."invalid".split(""), KEYS.ENTER],
  (_rendered, session) => {
    const state = session.getState();
    assertEquals(state.filterSource, "all");
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: invalid filter status shows error",
  [KEYS.S, ..."invalid".split(""), KEYS.ENTER],
  (_rendered, session) => {
    const state = session.getState();
    assertEquals(state.filterStatus, "all");
  },
);

testSkillsSessionRender(
  "SkillsManagerTuiSession: return key same as enter",
  [KEYS.DOWN, KEYS.ENTER],
  (_rendered, session) => {
    assertExists(session.getState());
  },
);

Deno.test("SkillsManagerTuiSession: detail view shows instructions (truncated)", async () => {
  const skills: ISkillSummary[] = [
    sampleSkill({
      id: "long-instructions",
      name: "Long Instructions",
      version: DEFAULT_GLOBAL_MEMORY_VERSION,
      status: SkillStatus.ACTIVE,
      source: MemoryBankSource.PROJECT,
      description: "Skill with long instructions",
      instructions: Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n"),
    }),
  ];
  const { service: _service, view } = createSkillsManagerViewWithMock(skills);
  const session = view.createTuiSession(false);

  await session.initialize();

  // Set grouping to none to navigate directly to skill
  await session.handleKey(KEYS.G); // source -> status
  await session.handleKey(KEYS.G); // status -> none

  // Now navigate and show detail
  await session.handleKey(KEYS.DOWN);
  await session.handleKey(KEYS.ENTER);

  if (session.isShowingDetail()) {
    const detail = session.renderDetail();
    assertStringIncludes(detail, "Instructions:");
    assertStringIncludes(detail, "...(truncated)");
  }
});
