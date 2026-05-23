/**
 * @module DependencyResolver
 * @path packages/flow/src/dependency_resolver.ts
 * @related-files []
 * @architectural-layer Flow
 * @description Resolves dependencies in flow steps, detects cycles, and organizes execution waves for parallel processing.
 */

import type { IFlowStep } from "@exaix/schemas/flow.ts";

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

  private buildGraph(): void {
    for (const step of this.steps.values()) {
      this.adjacencyList.set(step.id, []);
      this.indegree.set(step.id, 0);
    }

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

  topologicalSort(): string[] {
    this.detectCycles();

    const result: string[] = [];
    const queue: string[] = [];
    const indegree = new Map(this.indegree);

    for (const [id, degree] of indegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

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

  groupIntoWaves(): string[][] {
    const order = this.topologicalSort();
    const waves: string[][] = [];
    const processed = new Set<string>();

    const firstWave = Array.from(this.indegree.entries())
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id);

    if (firstWave.length > 0) {
      waves.push(firstWave);
      firstWave.forEach((id) => processed.add(id));
    }

    while (processed.size < this.steps.size) {
      const currentWave: string[] = [];

      for (const stepId of order) {
        if (processed.has(stepId)) continue;

        const dependencies = this.steps.get(stepId)!.dependsOn;
        const allDepsProcessed = dependencies.every((dep) => processed.has(dep));

        if (allDepsProcessed) {
          currentWave.push(stepId);
        }
      }

      if (currentWave.length === 0) {
        throw new FlowValidationError("Unable to determine execution waves");
      }

      waves.push(currentWave);
      currentWave.forEach((id) => processed.add(id));
    }

    return waves;
  }
}
