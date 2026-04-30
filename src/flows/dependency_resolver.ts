/**
 * @module DependencyResolver
 * @path src/flows/dependency_resolver.ts
 * @description Resolves dependencies in flow steps, detects cycles, and organizes execution waves for parallel processing.
 * @architectural-layer Core
 * @related-files [src/flows/flow_runner.ts, "packages/schemas/src/flow.ts"]
 */
import type { IFlowStep } from "@exaix/schemas/flow.ts";

/**
 * Error thrown when flow validation fails due to dependency issues
 */
export class FlowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowValidationError";
  }
}
export class DependencyResolver {
  private steps: Map<string, IFlowStep>;
  private adjacencyList: Map<string, string[]>;
  private indegree: Map<string, number>;

  constructor(steps: IFlowStep[]) {
    this.steps = new Map(steps.map((step) => [step.id, step]));
    this.adjacencyList = new Map();
    this.indegree = new Map();

    this.buildGraph();
  }

  /**
   * Builds the dependency graph from flow steps
   */
  private buildGraph(): void {
    // Initialize adjacency list and indegree for all steps
    for (const step of this.steps.values()) {
      this.adjacencyList.set(step.id, []);
      this.indegree.set(step.id, 0);
    }

    // Build dependencies
    for (const step of this.steps.values()) {
      for (const depId of step.dependsOn) {
        if (!this.steps.has(depId)) {
          throw new FlowValidationError(`Dependency '${depId}' not found in step definitions`);
        }
        this.adjacencyList.get(depId)!.push(step.id);
        this.indegree.set(step.id, this.indegree.get(step.id)! + 1);
      }
    }
  }

  /**
   * Performs topological sort using Kahn's algorithm
   * Throws FlowValidationError if cycles are detected
   */
  topologicalSort(): string[] {
    this.detectCycles();

    const result: string[] = [];
    const queue: string[] = [];
    const indegree = new Map(this.indegree);

    // Start with nodes that have no incoming edges
    for (const [id, degree] of indegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      // Reduce indegree of neighbors
      for (const neighbor of this.adjacencyList.get(current)!) {
        indegree.set(neighbor, indegree.get(neighbor)! - 1);
        if (indegree.get(neighbor)! === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (result.length !== this.steps.size) {
      throw new FlowValidationError("Cycle detected in dependency graph");
    }

    return result;
  }

  /**
   * Detects cycles using DFS with three-color marking
   * Throws FlowValidationError if cycles are found
   */
  private detectCycles(): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      inStack.add(node);
      path.push(node);

      for (const neighbor of this.adjacencyList.get(node)!) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (inStack.has(neighbor)) {
          // Cycle found
          const cycleStart = path.indexOf(neighbor);
          const cycle = [...path.slice(cycleStart), neighbor];
          throw new FlowValidationError(
            `Cycle detected in dependency graph: ${cycle.join(" -> ")}`,
          );
        }
      }

      inStack.delete(node);
      path.pop();
    };

    for (const stepId of this.steps.keys()) {
      if (!visited.has(stepId)) {
        dfs(stepId);
      }
    }
  }

  /**
   * Groups steps into execution waves for parallel processing
   * Each wave contains steps that can be executed in parallel
   */
  groupIntoWaves(): string[][] {
    const order = this.topologicalSort();
    const waves: string[][] = [];
    const processed = new Set<string>();

    // Start with steps that have no dependencies
    const firstWave = Array.from(this.indegree.entries())
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id);

    if (firstWave.length > 0) {
      waves.push(firstWave);
      firstWave.forEach((id) => processed.add(id));
    }

    // Build subsequent waves
    while (processed.size < this.steps.size) {
      const currentWave: string[] = [];

      for (const stepId of order) {
        if (processed.has(stepId)) continue;

        // Check if all dependencies are in previous waves
        const dependencies = this.steps.get(stepId)!.dependsOn;
        const allDepsProcessed = dependencies.every((dep) => processed.has(dep));

        if (allDepsProcessed) {
          currentWave.push(stepId);
        }
      }

      if (currentWave.length === 0) {
        // This shouldn't happen if topological sort is correct
        throw new FlowValidationError("Unable to determine execution waves");
      }

      waves.push(currentWave);
      currentWave.forEach((id) => processed.add(id));
    }

    return waves;
  }
}
