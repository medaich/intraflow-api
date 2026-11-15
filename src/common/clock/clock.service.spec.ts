import { ClockService } from "./clock.service";

describe("ClockService", () => {
  let clock: ClockService;

  beforeEach(() => {
    clock = new ClockService();
  });

  it("returns current date by default", () => {
    const before = Date.now();
    const now = clock.now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it("returns fixed date when set", () => {
    const fixed = new Date("2026-06-15T12:00:00Z");
    clock.setFixedTime(fixed);
    expect(clock.now().toISOString()).toBe("2026-06-15T12:00:00.000Z");

    clock.setFixedTime("2026-12-01T00:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("resets back to system clock", () => {
    clock.setFixedTime("2020-01-01T00:00:00Z");
    expect(clock.now().getFullYear()).toBe(2020);

    clock.reset();
    expect(clock.now().getFullYear()).toBeGreaterThanOrEqual(2024);
  });
});
