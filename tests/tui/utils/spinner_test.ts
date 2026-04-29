/**
 * @module TUISpinnerTest
 * @path tests/tui/utils/spinner_test.ts
 * @description Verifies the logic for terminal loading animations, ensuring correct frame sequences
 * and consistent timing for various spinner styles.
 */

import { assertEquals, assertGreater, assertStringIncludes } from "@std/assert";
import {
  createLoadingState,
  createProgressState,
  createSpinnerState,
  formatDuration,
  incrementProgress,
  nextFrame,
  renderActivityIndicator,
  renderProgressBar,
  renderPulsingDot,
  renderSpinner,
  renderSpinnerFrame,
  SPINNERS,
  startLoading,
  startSpinner,
  stopLoading,
  stopSpinner,
  updateProgress,
} from "../../../src/tui/helpers/spinner.ts";
import { SpinnerStyle } from "@exaix/tui";

// ===== Spinner Definitions Tests =====

Deno.test("SPINNERS: has all spinner styles", () => {
  const styles = ["dots", "braille", "line", "arc", "bounce", "pulse"];
  for (const style of styles) {
    assertEquals(style in SPINNERS, true, `Should have style: ${style}`);
  }
});

Deno.test("SPINNERS: dots has frames", () => {
  assertEquals(SPINNERS.dots.frames.length, 10);
  assertEquals(SPINNERS.dots.interval, 80);
});

Deno.test("SPINNERS: all spinners have required properties", () => {
  for (
    const [style, config] of Object.entries(SPINNERS) as Array<
      [string, { frames: string[]; interval: number; style: string }]
    >
  ) {
    assertGreater(config.frames.length, 0, `${style} should have frames`);
    assertGreater(config.interval, 0, `${style} should have interval`);
    assertEquals(config.style, style);
  }
});

// ===== Spinner State Tests =====

Deno.test("createSpinnerState: creates inactive state", () => {
  const state = createSpinnerState();
  assertEquals(state.active, false);
  assertEquals(state.frame, 0);
  assertEquals(state.message, "");
});

Deno.test("createSpinnerState: accepts message", () => {
  const state = createSpinnerState("Loading...");
  assertEquals(state.message, "Loading...");
});

Deno.test("startSpinner: activates spinner", () => {
  const initial = createSpinnerState();
  const started = startSpinner(initial, "Working...");
  assertEquals(started.active, true);
  assertEquals(started.message, "Working...");
  assertGreater(started.startTime, 0);
});

Deno.test("stopSpinner: deactivates spinner", () => {
  const started = startSpinner(createSpinnerState(), "Working...");
  const stopped = stopSpinner(started);
  assertEquals(stopped.active, false);
});

Deno.test("nextFrame: increments frame", () => {
  let state = createSpinnerState();
  state = startSpinner(state);
  assertEquals(state.frame, 0);
  state = nextFrame(state);
  assertEquals(state.frame, 1);
  state = nextFrame(state);
  assertEquals(state.frame, 2);
});

// ===== Spinner Rendering Tests =====

Deno.test("renderSpinnerFrame: returns frame character", () => {
  const frame = renderSpinnerFrame(0, SpinnerStyle.DOTS);
  assertEquals(frame, "⠋");
});

Deno.test("renderSpinnerFrame: cycles through frames", () => {
  const frames = new Set<string>();
  for (let i = 0; i < 10; i++) {
    frames.add(renderSpinnerFrame(i, SpinnerStyle.DOTS));
  }
  assertEquals(frames.size, 10);
});

Deno.test("renderSpinnerFrame: wraps around", () => {
  const frame0 = renderSpinnerFrame(0, SpinnerStyle.DOTS);
  const frame10 = renderSpinnerFrame(10, SpinnerStyle.DOTS);
  assertEquals(frame0, frame10);
});

Deno.test("renderSpinner: returns empty when inactive", () => {
  const state = createSpinnerState();
  const result = renderSpinner(state);
  assertEquals(result, "");
});

Deno.test("renderSpinner: includes message when active", () => {
  let state = createSpinnerState("Loading...");
  state = startSpinner(state);
  const result = renderSpinner(state, { useColors: false });
  assertStringIncludes(result, "Loading...");
});

Deno.test("renderSpinner: shows elapsed time when enabled", () => {
  let state = createSpinnerState("Working...");
  state = startSpinner(state);
  // Simulate some time passed
  state = { ...state, startTime: Date.now() - 5000 };
  const result = renderSpinner(state, { useColors: false, showElapsed: true });
  assertStringIncludes(result, "5s");
});

// ===== Progress State Tests =====

Deno.test("createProgressState: creates initial state", () => {
  const state = createProgressState(100);
  assertEquals(state.current, 0);
  assertEquals(state.total, 100);
  assertGreater(state.startTime, 0);
});

Deno.test("updateProgress: updates current value", () => {
  let state = createProgressState(100);
  state = updateProgress(state, 50);
  assertEquals(state.current, 50);
});

Deno.test("updateProgress: clamps to total", () => {
  let state = createProgressState(100);
  state = updateProgress(state, 150);
  assertEquals(state.current, 100);
});

Deno.test("incrementProgress: increments by one", () => {
  let state = createProgressState(100);
  state = incrementProgress(state);
  assertEquals(state.current, 1);
  state = incrementProgress(state);
  assertEquals(state.current, 2);
});

// ===== Progress Bar Rendering Tests =====

Deno.test("renderProgressBar: shows 0%", () => {
  const state = createProgressState(100);
  const result = renderProgressBar(state, { useColors: false });
  assertStringIncludes(result, "0%");
  assertStringIncludes(result, "░");
});

Deno.test("renderProgressBar: shows 50%", () => {
  let state = createProgressState(100);
  state = updateProgress(state, 50);
  const result = renderProgressBar(state, { useColors: false });
  assertStringIncludes(result, "50%");
});

Deno.test("renderProgressBar: shows 100%", () => {
  let state = createProgressState(100);
  state = updateProgress(state, 100);
  const result = renderProgressBar(state, { useColors: false });
  assertStringIncludes(result, "100%");
  assertStringIncludes(result, "█");
});

Deno.test("renderProgressBar: shows count when enabled", () => {
  let state = createProgressState(100);
  state = updateProgress(state, 25);
  const result = renderProgressBar(state, { useColors: false, showCount: true });
  assertStringIncludes(result, "25/100");
});

Deno.test("renderProgressBar: respects width", () => {
  const state = createProgressState(100);
  const result = renderProgressBar(state, { useColors: false, width: 10 });
  assertStringIncludes(result, "[");
  assertStringIncludes(result, "]");
});

// ===== Format Duration Tests =====

Deno.test("formatDuration: formats seconds", () => {
  assertEquals(formatDuration(30), "30s");
  assertEquals(formatDuration(59), "59s");
});

Deno.test("formatDuration: formats minutes", () => {
  assertEquals(formatDuration(60), "1m");
  assertEquals(formatDuration(90), "1m 30s");
  assertEquals(formatDuration(120), "2m");
});

Deno.test("formatDuration: formats hours", () => {
  assertEquals(formatDuration(3600), "1h");
  assertEquals(formatDuration(3660), "1h 1m");
  assertEquals(formatDuration(7200), "2h");
});

// ===== Animated Indicators Tests =====

Deno.test("renderPulsingDot: returns different characters", () => {
  const dots = new Set<string>();
  for (let i = 0; i < 8; i++) {
    // Strip ANSI for comparison
    const dot = renderPulsingDot(i, false);
    dots.add(dot);
  }
  assertGreater(dots.size, 1);
});

Deno.test("renderActivityIndicator: shows inactive state", () => {
  const result = renderActivityIndicator(false, 0, false);
  assertEquals(result, "○");
});

Deno.test("renderActivityIndicator: shows active state", () => {
  const result = renderActivityIndicator(true, 0, false);
  // Should be a pulsing character
  assertStringIncludes("○◔◑◕●", result);
});

// ===== Loading State Tests =====

Deno.test("createLoadingState: creates initial state", () => {
  const state = createLoadingState();
  assertEquals(state.isLoading, false);
  assertEquals(state.message, "");
});

Deno.test("startLoading: sets loading state", () => {
  let state = createLoadingState();
  state = startLoading(state, "Loading data...");
  assertEquals(state.isLoading, true);
  assertEquals(state.message, "Loading data...");
  assertEquals(state.spinner.active, true);
});

Deno.test("stopLoading: clears loading state", () => {
  let state = createLoadingState();
  state = startLoading(state, "Loading...");
  state = stopLoading(state);
  assertEquals(state.isLoading, false);
  assertEquals(state.message, "");
  assertEquals(state.spinner.active, false);
});
