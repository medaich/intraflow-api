import { hasCycle, detectDependencyCycle } from './cycle-detection';

describe('Cycle Detection for Task Dependencies', () => {
  it('detects a self-dependency cycle', () => {
    // Task 1 depends on Task 1
    const dependencies = new Map<number, number[]>([
      [1, [1]],
    ]);
    expect(hasCycle(dependencies)).toBe(true);
    expect(detectDependencyCycle(1, [1], new Map())).toBe(true);
  });

  it('detects a 2-node cycle (A -> B -> A)', () => {
    // Existing graph: Task 2 depends on Task 1
    // Proposed change: Task 1 depends on Task 2
    const existingDependencies = new Map<number, number[]>([
      [2, [1]],
    ]);
    expect(detectDependencyCycle(1, [2], existingDependencies)).toBe(true);
  });

  it('detects a 3-node cycle (A -> B -> C -> A)', () => {
    // Existing graph: 2 depends on 1, 3 depends on 2
    // Proposed change: 1 depends on 3
    const existingDependencies = new Map<number, number[]>([
      [2, [1]],
      [3, [2]],
    ]);
    expect(detectDependencyCycle(1, [3], existingDependencies)).toBe(true);
  });

  it('allows a valid linear DAG without cycles (1 -> 2 -> 3)', () => {
    // 3 depends on 2, 2 depends on 1
    const dependencies = new Map<number, number[]>([
      [3, [2]],
      [2, [1]],
      [1, []],
    ]);
    expect(hasCycle(dependencies)).toBe(false);
    expect(detectDependencyCycle(3, [2], new Map([[2, [1]], [1, []]]))).toBe(false);
  });

  it('allows a diamond DAG without cycles (A -> B, A -> C, B -> D, C -> D)', () => {
    // D depends on B and C; B depends on A; C depends on A
    const existingDependencies = new Map<number, number[]>([
      [2, [1]], // B depends on A
      [3, [1]], // C depends on A
      [1, []],
    ]);
    // Proposed: D (4) depends on B (2) and C (3)
    expect(detectDependencyCycle(4, [2, 3], existingDependencies)).toBe(false);
  });

  it('allows replacing dependencies with empty array', () => {
    const existingDependencies = new Map<number, number[]>([
      [2, [1]],
    ]);
    expect(detectDependencyCycle(2, [], existingDependencies)).toBe(false);
  });
});
