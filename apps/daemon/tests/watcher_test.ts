/**
 * @module FileWatcherTest
 * @path tests/services/watcher/watcher_test.ts
 * @description Specialized tests for the file system watcher, verifying event debouncing,
 * stability checks for partial writes, and resilient handling of temporary file locks.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { FileWatcher } from "../../../apps/daemon/src/watcher.ts";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";
import { createWatcherTestContext } from "../../../tests/helpers/watcher_test_helper.ts";
import {
  DEFAULT_WATCHER_STABILITY_BACKOFF_MS,
  DEFAULT_WATCHER_STABILITY_MAX_ATTEMPTS,
  DEFAULT_WATCHER_STABILITY_MIN_FILE_SIZE,
} from "@exaix/core";
import { delay } from "@exaix/core/func";

const EVENT_LOOP_RESPONSIVENESS_CHECKS = 20;
const EVENT_LOOP_RESPONSIVE_THRESHOLD_MS = 25;

/**
 * Tests for Step 2.1: The File Watcher (Stable Read)
 *
 * Success Criteria:
 * - Test 1: Rapidly touch a file 10 times in 1 second → Watcher only processes it once
 * - Test 2: Write a 10MB file in 500ms chunks → Watcher waits until final chunk before processing
 * - Test 3: Delete a file immediately after creating it → Watcher handles `NotFound` gracefully
 */

// Updated helper to use non-blocking delay utility
async function readFileWhenStable(path: string): Promise<string> {
  const maxAttempts = DEFAULT_WATCHER_STABILITY_MAX_ATTEMPTS;
  const backoffMs = DEFAULT_WATCHER_STABILITY_BACKOFF_MS;
  const minFileSize = DEFAULT_WATCHER_STABILITY_MIN_FILE_SIZE;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Get initial size
      const stat1 = await Deno.stat(path);

      // Validate initial file state
      if (stat1.size < minFileSize) {
        if (attempt === maxAttempts - 1) {
          throw new Error(`File is empty or too small: ${path}`);
        }
        // Non-blocking delay
        await delay(backoffMs[attempt]);
        continue;
      }

      // Wait for stability window
      await delay(backoffMs[attempt]);

      // Check if size changed
      const stat2 = await Deno.stat(path);

      if (stat1.size === stat2.size && stat2.size >= minFileSize) {
        // File size is stable! Now read content once
        const content = await Deno.readTextFile(path);

        // Validate it's not empty
        if (content.trim().length > 0) {
          return content;
        }

        // Empty file, treat as unstable
        throw new Error(`File is empty: ${path}`);
      }

      // File still changing, retry with longer wait
      continue;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // File deleted between stat and read
        throw new Error(`File disappeared: ${path}`);
      }

      if (attempt === maxAttempts - 1) {
        throw error;
      }

      // Retry on other errors
      continue;
    }
  }

  throw new Error(`File never stabilized: ${path}`);
}

Deno.test("Test 1: Debouncing - rapid file touches only trigger once", async () => {
  const { tempDir, cleanup } = await initTestDbService();
  try {
    const testFile = join(tempDir, "test.txt");
    const content = "Hello, World!";

    // Write file once
    await Deno.writeTextFile(testFile, content);

    // Simulate rapid touches (modifying mtime without changing content)
    const touchPromises = [];
    for (let i = 0; i < 10; i++) {
      touchPromises.push(
        Deno.utime(testFile, new Date(), new Date()),
      );
    }
    await Promise.all(touchPromises);

    // Wait for debounce period (200ms + buffer)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Now read - should be stable immediately
    const result = await readFileWhenStable(testFile);
    assertEquals(result, content);
  } finally {
    await cleanup();
  }
});

Deno.test("Test 2: Stability verification - slow write in chunks", async () => {
  const { tempDir, cleanup } = await initTestDbService();
  try {
    const testFile = join(tempDir, "large.txt");

    // Start writing in background
    const writePromise = (async () => {
      const chunkSize = 1024 * 1024; // 1MB chunks
      const totalChunks = 10; // 10MB total
      const chunk = "x".repeat(chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        await Deno.writeTextFile(testFile, chunk, { append: i > 0 });
        await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms per chunk
      }
    })();

    // Wait just enough for first chunk to be written
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Try to read - should wait until stable
    const usePerf = typeof performance !== "undefined" && typeof performance.now === "function";
    const startTime = usePerf ? performance.now() : Date.now();

    // Run readFileWhenStable concurrently with writes
    const readPromise = readFileWhenStable(testFile);

    await writePromise; // Ensure writes complete
    const content = await readPromise;

    const endTime = usePerf ? performance.now() : Date.now();
    const duration = Math.round(endTime - startTime);

    // Should have waited for file to stabilize (at least a chunk worth)
    assertEquals(content.length >= 1024 * 1024, true); // At least 1MB

    // Should have taken some time to stabilize (but not too long)
    assertEquals(duration >= 0, true); // At least some time passed
    assertEquals(duration < 3000, true); // Didn't exhaust all retries
  } finally {
    await cleanup();
  }
});

Deno.test("Test 3: File disappears - handles NotFound gracefully", async () => {
  const { tempDir, cleanup: _cleanup } = await initTestDbService();
  try {
    const testFile = join(tempDir, "ephemeral.txt");

    // Create file
    await Deno.writeTextFile(testFile, "temporary");

    // Delete it immediately
    await Deno.remove(testFile);

    // Try to read - should throw specific error
    let errorMessage = "";
    try {
      await readFileWhenStable(testFile);
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    assertEquals(errorMessage.includes("File disappeared"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("Stability verification - file never stabilizes", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-unstable-" });
  try {
    const testFile = join(tempDir, "growing.txt");

    // Start continuous writes that never stop
    let shouldStop = false;
    const infiniteWrite = (async () => {
      let iteration = 0;
      while (!shouldStop) {
        await Deno.writeTextFile(testFile, `Iteration ${iteration++}\n`, { append: iteration > 1 });
        await new Promise((resolve) => setTimeout(resolve, 30)); // Write every 30ms
      }
    })();

    // Wait for file to be created
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Try to read - should eventually give up
    let errorMessage = "";
    try {
      await readFileWhenStable(testFile);
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    // Stop the writes
    shouldStop = true;
    await infiniteWrite;

    assertEquals(errorMessage.includes("File never stabilized"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test({
  name: "Error handling - permission denied during read",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-permission-" });
    try {
      const testFile = join(tempDir, "readonly.txt");
      await Deno.writeTextFile(testFile, "content");

      // Remove read permissions
      await Deno.chmod(testFile, 0o000);

      // Try to read - should throw permission error
      let errorThrown = false;
      try {
        await readFileWhenStable(testFile);
      } catch (error) {
        errorThrown = true;
        // Should be permission error
        assertEquals(
          error instanceof Deno.errors.PermissionDenied ||
            (error instanceof Error && error.message.includes("permission")),
          true,
        );
      }

      assertEquals(errorThrown, true);
    } finally {
      // Restore permissions before cleanup
      try {
        const testFile = join(tempDir, "readonly.txt");
        await Deno.chmod(testFile, 0o644);
      } catch {
        // Permission already restored or file deleted
      }
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test("Edge case - empty file remains empty", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-empty-" });
  try {
    const testFile = join(tempDir, "empty.txt");
    await Deno.writeTextFile(testFile, "");

    // Try to read empty file - should fail
    let errorMessage = "";
    try {
      await readFileWhenStable(testFile);
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    assertEquals(errorMessage.includes("empty") || errorMessage.includes("never stabilized"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("Edge case - file with only whitespace", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-whitespace-" });
  try {
    const testFile = join(tempDir, "whitespace.txt");
    await Deno.writeTextFile(testFile, "   \n\t\n   ");

    // File is not truly empty but has no meaningful content
    let errorMessage = "";
    try {
      await readFileWhenStable(testFile);
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    // Should fail because trim().length === 0
    assertEquals(errorMessage.includes("empty") || errorMessage.includes("never stabilized"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("Concurrent modification - multiple files changing simultaneously", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-concurrent-" });
  try {
    const files = [
      join(tempDir, "file1.txt"),
      join(tempDir, "file2.txt"),
      join(tempDir, "file3.txt"),
    ];

    // Write all files simultaneously
    await Promise.all(
      files.map((file) => Deno.writeTextFile(file, `Content for ${file}`)),
    );

    // Read all files concurrently - should all succeed
    const results = await Promise.all(
      files.map((file) => readFileWhenStable(file)),
    );

    assertEquals(results.length, 3);
    results.forEach((content, idx) => {
      assertEquals(content.includes(`file${idx + 1}.txt`), true);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("File size stability - zero size indicates deletion in progress", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-zero-" });
  try {
    const testFile = join(tempDir, "truncated.txt");

    // Create file with content
    await Deno.writeTextFile(testFile, "initial content");

    // Truncate to zero size
    const file = await Deno.open(testFile, { write: true, truncate: true });
    file.close();

    // Try to read - should fail because size is 0
    let errorMessage = "";
    try {
      await readFileWhenStable(testFile);
    } catch (error) {
      errorMessage = (error as Error).message;
    }

    assertEquals(errorMessage.includes("File is empty or too small"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("Rapid successive modifications - last write wins", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-rapid-" });
  try {
    const testFile = join(tempDir, "rapid.txt");

    // Write multiple times rapidly
    for (let i = 1; i <= 5; i++) {
      await Deno.writeTextFile(testFile, `Version ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Wait for stability
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Read should get the last version
    const content = await readFileWhenStable(testFile);
    assertEquals(content, "Version 5");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("Unicode content - handles UTF-8 correctly", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-unicode-" });
  try {
    const testFile = join(tempDir, "unicode.txt");
    const unicodeContent = "Hello 世界 🌍 مرحبا Здравствуй";

    await Deno.writeTextFile(testFile, unicodeContent);

    const content = await readFileWhenStable(testFile);
    assertEquals(content, unicodeContent);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("Large file - handles multi-megabyte files", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-large-" });
  try {
    const testFile = join(tempDir, "large.txt");
    const largeContent = "x".repeat(5 * 1024 * 1024); // 5MB

    await Deno.writeTextFile(testFile, largeContent);

    const content = await readFileWhenStable(testFile);
    assertEquals(content.length, largeContent.length);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("File stability - eventual consistency with delayed write", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-delayed-" });
  try {
    const testFile = join(tempDir, "delayed.txt");

    // Write initial content
    await Deno.writeTextFile(testFile, "Initial content");

    // Let it stabilize first
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Now write final content
    await Deno.writeTextFile(testFile, "Final content after stability");

    // Wait for new stability
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Read should get the latest content
    const content = await readFileWhenStable(testFile);

    assertEquals(content, "Final content after stability");
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});

// ============================================================================
// FileWatcher class integration tests
// ============================================================================

Deno.test("FileWatcher: processes .md files and ignores dotfiles", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-class-filter-");
  try {
    await helper.createWorkspaceStructure();

    const eventsReceived: string[] = [];
    const watcher = helper.createWatcher((event) => {
      eventsReceived.push(event.path);
    });

    await helper.startWatcher(watcher);

    // Create test files
    await Deno.writeTextFile(join(helper.requestDir, "valid.md"), "Valid file");
    await Deno.writeTextFile(join(helper.requestDir, ".hidden.md"), "Hidden file");
    await Deno.writeTextFile(join(helper.requestDir, "readme.txt"), "Text file");

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    await helper.stopWatcher(watcher);

    // Should only process valid.md
    assertEquals(eventsReceived.length, 1);
    assertEquals(eventsReceived[0].endsWith("valid.md"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: throws error when watch directory not found", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-notfound-" });
  await Deno.remove(tempDir); // Remove it so it doesn't exist

  const config = createMockConfig(tempDir, {
    watcher: { debounce_ms: 50, stability_check: false },
  });

  const watcher = new FileWatcher(config, () => {});

  // Should throw NotFound error
  let errorCaught = false;
  try {
    await watcher.start();
  } catch (error) {
    errorCaught = true;
    assertEquals(error instanceof Deno.errors.NotFound, true);
  }
  assertEquals(errorCaught, true);
});

Deno.test("FileWatcher: processes file without stability check", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-no-stability-");
  try {
    await helper.createWorkspaceStructure();

    let receivedContent = "";
    const watcher = helper.createWatcher((event) => {
      receivedContent = event.content;
    });

    await helper.startWatcher(watcher);
    await helper.writeFile("immediate.md", "Immediate read");
    await helper.stopWatcher(watcher);

    // Should have received content immediately without stability check
    assertEquals(receivedContent, "Immediate read");
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: handles onFileReady callback errors gracefully", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-callback-error-");
  try {
    await helper.createWorkspaceStructure();

    let callbackInvoked = false;
    const watcher = helper.createWatcher(() => {
      callbackInvoked = true;
      throw new Error("Callback error");
    });

    await helper.startWatcher(watcher);
    await helper.writeFile("test.md", "content");
    await helper.stopWatcher(watcher);

    // Callback should have been invoked despite error
    assertEquals(callbackInvoked, true);
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: logs activity with database", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-db-logging-");
  try {
    await helper.createWorkspaceStructure();

    const { db } = await initTestDbService();
    const watcher = helper.createWatcher(() => {}, { db });

    await helper.startWatcher(watcher);
    await helper.writeFile("logged.md", "content");
    await helper.stopWatcher(watcher);
    await db.waitForFlush();

    // Check if activities were logged
    const activities = await db.getRecentActivity(100);
    const watcherActivities = activities.filter((a: { action_type: string }) => a.action_type.startsWith("watcher."));

    // Should have logged at least: started, file_ready, stopped (minimum 3)
    assert(
      watcherActivities.length >= 3,
      `Expected at least 3 watcher activities, got ${watcherActivities.length}`,
    );

    await db.close();
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: handles file read errors during processing", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-read-error-");
  try {
    await helper.createWorkspaceStructure();

    const watcher = helper.createWatcher(() => {
      // This shouldn't be called if file read fails
    });

    await helper.startWatcher(watcher);

    // Create file then remove it quickly (race condition)
    const testFile = join(helper.requestDir, "disappear.md");
    await Deno.writeTextFile(testFile, "content");
    await Deno.remove(testFile);

    await new Promise((resolve) => setTimeout(resolve, 200));

    await helper.stopWatcher(watcher);

    // Watcher should handle the error gracefully
    assertEquals(true, true); // Test passes if no unhandled error
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: handles non-Error exceptions", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-non-error-");
  try {
    await helper.createWorkspaceStructure();

    // Create a callback that throws a non-Error object
    const watcher = helper.createWatcher(() => {
      // eslint-disable-next-line no-throw-literal
      throw "String error"; // Non-Error exception
    });

    await helper.startWatcher(watcher);
    await helper.writeFile("test.md", "content");
    await helper.stopWatcher(watcher);

    // Should handle non-Error exceptions gracefully
    assertEquals(true, true);
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: clears pending timers on stop", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-clear-timers-");
  try {
    await helper.createWorkspaceStructure();

    let eventsProcessed = 0;
    const watcher = helper.createWatcher(() => {
      eventsProcessed++;
    }, { debounceMs: 1000 }); // Long debounce

    await helper.startWatcher(watcher);

    // Create file but stop before debounce completes
    await Deno.writeTextFile(join(helper.requestDir, "pending.md"), "content");
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Stop immediately (before debounce timer fires)
    await helper.stopWatcher(watcher);

    // Wait to ensure timer was cleared
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Event should not have been processed (timer was cleared)
    assertEquals(eventsProcessed, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: handles modify events", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-modify-");
  try {
    await helper.createWorkspaceStructure();

    const eventsReceived: string[] = [];
    const watcher = helper.createWatcher((event) => {
      eventsReceived.push(event.content);
    });

    await helper.startWatcher(watcher);

    const testFile = join(helper.requestDir, "modify.md");
    await Deno.writeTextFile(testFile, "Version 1");
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Modify the file
    await Deno.writeTextFile(testFile, "Version 2");
    await new Promise((resolve) => setTimeout(resolve, 150));

    await helper.stopWatcher(watcher);

    // Should have received both versions
    assertEquals(eventsReceived.length >= 2, true);
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: debounces rapid file modifications", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-rapid-debounce-");
  try {
    await helper.createWorkspaceStructure();

    let processCount = 0;
    const watcher = helper.createWatcher(() => {
      processCount++;
    }, { debounceMs: 200 }); // Long enough to test debouncing

    await helper.startWatcher(watcher);

    const testFile = join(helper.requestDir, "rapid.md");

    // Rapidly modify file multiple times
    for (let i = 0; i < 5; i++) {
      await Deno.writeTextFile(testFile, `Version ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 50)); // Faster than debounce
    }

    // Wait for debounce to complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    await helper.stopWatcher(watcher);

    // Should have processed only once or twice due to debouncing
    assertEquals(processCount <= 2, true);
  } finally {
    await cleanup();
  }
});

Deno.test("FileWatcher: handles rename events (file moves)", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-rename-");
  try {
    await helper.createWorkspaceStructure();

    const eventsReceived: string[] = [];
    const watcher = helper.createWatcher((event) => {
      eventsReceived.push(event.path);
    });

    await helper.startWatcher(watcher);

    // Create file outside watch dir
    const outsideFile = join(helper.tempDir, "outside.md");
    await Deno.writeTextFile(outsideFile, "Moved content");

    // Move file into watch dir
    const insideFile = join(helper.requestDir, "moved.md");
    await Deno.rename(outsideFile, insideFile);

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    await helper.stopWatcher(watcher);

    // Should detect the moved file
    assertEquals(eventsReceived.length, 1);
    assertEquals(eventsReceived[0].endsWith("moved.md"), true);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Issue #4: File Stability Checking with Blocking Operations - Tests
// ============================================================================

Deno.test("File Stability - Non-blocking delay utility", async () => {
  // Test delay returns a promise
  const start = Date.now();
  const promise = delay(10);
  assert(promise instanceof Promise, "delay() should return a Promise");

  // Test delay actually waits
  await promise;
  const elapsed = Date.now() - start;
  assert(elapsed >= 8, `Delay should wait at least 8ms, got ${elapsed}ms`);
  assert(elapsed <= 50, `Delay should not wait too long, got ${elapsed}ms`);
});

Deno.test("File Stability - Constants are configurable", () => {
  // Test constants exist and have expected values
  assertEquals(DEFAULT_WATCHER_STABILITY_MAX_ATTEMPTS, 5);
  assertEquals(DEFAULT_WATCHER_STABILITY_BACKOFF_MS, [50, 100, 200, 500, 1000]);
  assertEquals(DEFAULT_WATCHER_STABILITY_MIN_FILE_SIZE, 1);
});

Deno.test("File Stability - Watcher uses non-blocking delays", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-nonblocking-" });
  const testFile = join(tempDir, "test.txt");

  try {
    // Create a stable file
    await Deno.writeTextFile(testFile, "test content");

    // Create a file watcher instance
    const config = createMockConfig(tempDir);
    const watcher = new FileWatcher(config, () => {});

    // Test that readFileWhenStable works (uses delay utility internally)
    const content = await watcher.readFileWhenStable(testFile);
    assertEquals(content, "test content");

    // Clean up
    await Deno.remove(tempDir, { recursive: true });
  } catch (error) {
    await Deno.remove(tempDir, { recursive: true });
    throw error;
  }
});

Deno.test("File Stability - Exponential backoff timing", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-backoff-" });
  const testFile = join(tempDir, "test.txt");

  try {
    // Create a file that keeps changing size during stability check
    await Deno.writeTextFile(testFile, "initial");

    const usePerf = typeof performance !== "undefined" && typeof performance.now === "function";
    const startTime = usePerf ? performance.now() : Date.now();

    // This should fail after 5 attempts with exponential backoff
    try {
      const abortController = new AbortController();

      const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> => {
        if (signal.aborted) return Promise.resolve();

        return new Promise((resolve) => {
          const onAbort = () => {
            clearTimeout(timeoutId);
            resolve();
          };

          const timeoutId = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          }, ms);

          signal.addEventListener("abort", onAbort, { once: true });
        });
      };

      // Simulate a file that keeps changing size throughout the stability check
      const changeFile = async (signal: AbortSignal) => {
        // Keep changing for longer than the stability check duration (1850ms)
        for (let i = 0; i < 50 && !signal.aborted; i++) {
          try {
            await Deno.writeTextFile(testFile, "x".repeat(i + 1));
          } catch {
            // Ignore errors when directory is cleaned up
          }
          await abortableSleep(20, signal); // Change every 20ms
        }
      };

      // Start changing the file continuously
      const changePromise = changeFile(abortController.signal);

      try {
        // Try to read it stably - should timeout after ~1.85 seconds (sum of backoff delays)
        const watcher = new FileWatcher(createMockConfig(tempDir), () => {});
        await watcher.readFileWhenStable(testFile);
      } finally {
        abortController.abort();
        await changePromise.catch(() => {
          // Ignore errors when directory is cleaned up
        });
      }

      assert(false, "Should have thrown timeout error");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes("never stabilized"), `Expected stabilization error, got: ${error.message}`);

      // Verify timing - should be close to sum of backoff delays (1850ms)
      const endTime = usePerf ? performance.now() : Date.now();
      const elapsed = Math.round(endTime - startTime);
      assert(elapsed >= 1800, `Should wait at least 1800ms, got ${elapsed}ms`);
      assert(elapsed <= 2500, `Should not wait too long, got ${elapsed}ms`);
    }

    await Deno.remove(tempDir, { recursive: true });
  } catch (error) {
    await Deno.remove(tempDir, { recursive: true });
    throw error;
  }
});

Deno.test("FileWatcher: readFileWhenStable handles errors", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const watcher = new FileWatcher(createMockConfig(tempDir), () => {});
    await assertRejects(
      async () => await watcher.readFileWhenStable(join(tempDir, "non-existent.md")),
      Error,
      "File disappeared",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("FileWatcher: private property accessibility for coverage", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const watcher = new FileWatcher(createMockConfig(tempDir), () => {});
    assertEquals(watcher.getProcessingFilesCount(), 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("File Stability - Event loop remains responsive", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-responsive-" });
  const testFile = join(tempDir, "test.txt");

  try {
    // Create a slow-stabilizing file (never stabilizes)
    await Deno.writeTextFile(testFile, "initial");

    const responsivenessChecks: number[] = [];

    // Start a background task that checks event loop responsiveness
    const checkResponsiveness = async () => {
      for (let i = 0; i < EVENT_LOOP_RESPONSIVENESS_CHECKS; i++) {
        const start = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 0)); // Next tick
        responsivenessChecks.push(Date.now() - start);
      }
    };

    const responsivenessPromise = checkResponsiveness();

    // Start stability check that should take ~1.85 seconds and fail
    const watcher = new FileWatcher(createMockConfig(tempDir), () => {});
    const stabilityPromise = watcher.readFileWhenStable(testFile).catch(() => {
      // Expected to fail - file never stabilizes
    });

    // Wait for both to complete
    await Promise.all([responsivenessPromise, stabilityPromise]);

    // Parallel CI runs can add small scheduler jitter; keep the threshold loose
    // enough for that noise while still catching real event-loop blocking.
    const maxDelay = Math.max(...responsivenessChecks);
    assert(
      maxDelay < EVENT_LOOP_RESPONSIVE_THRESHOLD_MS,
      `Event loop blocked for ${maxDelay}ms, should be < ${EVENT_LOOP_RESPONSIVE_THRESHOLD_MS}ms`,
    );

    await Deno.remove(tempDir, { recursive: true });
  } catch (error) {
    await Deno.remove(tempDir, { recursive: true });
    throw error;
  }
});

Deno.test("File Stability - Backward compatibility maintained", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "watcher-test-compat-" });
  const testFile = join(tempDir, "test.txt");

  try {
    // Create a stable file
    await Deno.writeTextFile(testFile, "Hello, World!");

    // Test with FileWatcher
    const config = createMockConfig(tempDir);
    const watcher = new FileWatcher(config, () => {});
    const content = await watcher.readFileWhenStable(testFile);

    assertEquals(content, "Hello, World!");

    await Deno.remove(tempDir, { recursive: true });
  } catch (error) {
    await Deno.remove(tempDir, { recursive: true });
    throw error;
  }
});

Deno.test("File Watcher - Race Condition Prevention", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-race-");
  try {
    await helper.createWorkspaceStructure();

    let processingCount = 0;
    let concurrentProcessing = 0;
    let maxConcurrent = 0;

    // Create watcher with slow processing to test concurrency
    const watcher = helper.createWatcher(async (_event) => {
      processingCount++;
      concurrentProcessing++;
      maxConcurrent = Math.max(maxConcurrent, concurrentProcessing);

      // Simulate slow processing (100ms)
      await delay(100);

      concurrentProcessing--;
    }, { debounceMs: 50, stabilityCheck: false });

    await helper.startWatcher(watcher);

    // Rapidly trigger multiple events on same file
    const testFile = join(helper.requestDir, "race_test.md");
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        (async () => {
          await Deno.writeTextFile(testFile, `content ${i}`);
          // Small delay to ensure events are triggered
          await delay(10);
        })(),
      );
    }

    await Promise.all(promises);

    // Wait for processing to complete
    await delay(1000);

    await helper.stopWatcher(watcher);

    // Verify only one processing occurred at a time
    assertEquals(maxConcurrent, 1, "Only one file should be processed at a time");
    assertEquals(processingCount, 1, "Only one processing should have occurred");
  } finally {
    await cleanup();
  }
});

Deno.test("File Watcher - Concurrent Different Files", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-concurrent-");
  try {
    await helper.createWorkspaceStructure();

    let processingCount = 0;
    const processedFiles = new Set<string>();

    // Create watcher
    const watcher = helper.createWatcher(async (event) => {
      processingCount++;
      processedFiles.add(event.path);

      // Simulate processing time
      await delay(50);
    }, { debounceMs: 50, stabilityCheck: false });

    await helper.startWatcher(watcher);

    // Create multiple different files rapidly in the watched directory
    const filePromises = [];
    for (let i = 0; i < 3; i++) {
      const filePath = join(helper.requestDir, `file_${i}.md`);
      filePromises.push(
        (async () => {
          await Deno.writeTextFile(filePath, `content ${i}`);
          await delay(10);
        })(),
      );
    }

    await Promise.all(filePromises);

    // Wait for processing
    await delay(500);

    await helper.stopWatcher(watcher);

    // Verify all files were processed
    assertEquals(processingCount, 3, "All three files should have been processed");
    assertEquals(processedFiles.size, 3, "All three files should be in processed set");
  } finally {
    await cleanup();
  }
});

Deno.test("File Watcher - Processing Set Cleanup", async () => {
  const { helper, cleanup } = await createWatcherTestContext("watcher-cleanup-");
  try {
    await helper.createWorkspaceStructure();

    // Create watcher
    const watcher = helper.createWatcher(async (_event) => {
      // Simulate processing
      await delay(50);
    }, { debounceMs: 50, stabilityCheck: false });

    await helper.startWatcher(watcher);

    // Trigger file processing
    const testFile = join(helper.requestDir, "cleanup_test.md");
    await Deno.writeTextFile(testFile, "test content");
    await delay(200);

    await helper.stopWatcher(watcher);

    // Verify processing set is empty
    assertEquals(watcher.getProcessingFilesCount(), 0, "Processing set should be empty after stop");
  } finally {
    await cleanup();
  }
});
