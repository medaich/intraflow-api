/**
 * Detects whether a directed graph contains a cycle using DFS (Depth-First Search).
 * Graph is represented as Map<nodeId, array of nodeIds it depends on / edges>.
 */
export function hasCycle(graph: Map<number, number[]>): boolean {
  // 0: unvisited, 1: visiting (in current recursion stack), 2: visited
  const visited = new Map<number, number>();

  function dfs(node: number): boolean {
    const state = visited.get(node) ?? 0;
    if (state === 1) {
      // Cycle detected
      return true;
    }
    if (state === 2) {
      return false;
    }

    visited.set(node, 1);
    const neighbors = graph.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor)) {
        return true;
      }
    }
    visited.set(node, 2);
    return false;
  }

  for (const node of graph.keys()) {
    if ((visited.get(node) ?? 0) === 0) {
      if (dfs(node)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether setting dependencies for `taskId` to `newDependsOn` will introduce a cycle
 * in the existing dependency graph.
 */
export function detectDependencyCycle(
  taskId: number,
  newDependsOn: number[],
  existingGraph: Map<number, number[]>,
): boolean {
  if (newDependsOn.includes(taskId)) {
    return true;
  }

  // Build the proposed graph
  const graph = new Map<number, number[]>();
  for (const [key, val] of existingGraph.entries()) {
    graph.set(key, [...val]);
  }
  graph.set(taskId, [...newDependsOn]);

  // Ensure all referenced nodes exist as keys in graph
  for (const deps of graph.values()) {
    for (const depId of deps) {
      if (!graph.has(depId)) {
        graph.set(depId, []);
      }
    }
  }

  return hasCycle(graph);
}
