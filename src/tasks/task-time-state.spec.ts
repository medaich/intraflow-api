import { TaskStatus } from "./entities/task.entity";
import { computeTaskTimeState, TaskTimeState } from "./task-time-state";
import { checkProjectIsOverdue } from "../projects/project-progress";
import { ProjectStatus } from "../projects/entities/project.entity";

describe("Derived Time States Unit Tests", () => {
  const baseTime = new Date("2026-06-15T12:00:00.000Z");

  describe("computeTaskTimeState", () => {
    it("returns DONE for COMPLETED status regardless of dates", () => {
      // Completed even past end date
      const pastEnd = new Date("2026-06-10T00:00:00.000Z");
      const pastStart = new Date("2026-06-01T00:00:00.000Z");
      expect(
        computeTaskTimeState(TaskStatus.COMPLETED, pastStart, pastEnd, baseTime),
      ).toBe(TaskTimeState.DONE);

      // Completed with future dates
      const futureEnd = new Date("2026-06-20T00:00:00.000Z");
      expect(
        computeTaskTimeState(TaskStatus.COMPLETED, baseTime, futureEnd, baseTime),
      ).toBe(TaskTimeState.DONE);
    });

    it("returns OVERDUE when endDate is strictly before now for non-completed task", () => {
      const pastEnd = new Date("2026-06-15T11:59:59.999Z");
      const pastStart = new Date("2026-06-01T00:00:00.000Z");
      expect(
        computeTaskTimeState(TaskStatus.IN_PROGRESS, pastStart, pastEnd, baseTime),
      ).toBe(TaskTimeState.OVERDUE);
    });

    it("boundary test: returns ACTIVE (not OVERDUE) when endDate is exactly now", () => {
      const pastStart = new Date("2026-06-01T00:00:00.000Z");
      const exactEnd = new Date("2026-06-15T12:00:00.000Z"); // same as baseTime
      expect(
        computeTaskTimeState(TaskStatus.IN_PROGRESS, pastStart, exactEnd, baseTime),
      ).toBe(TaskTimeState.ACTIVE);
    });

    it("returns UPCOMING when startDate is strictly after now and endDate is in the future", () => {
      const futureStart = new Date("2026-06-15T12:00:00.001Z");
      const futureEnd = new Date("2026-06-20T00:00:00.000Z");
      expect(
        computeTaskTimeState(TaskStatus.PENDING, futureStart, futureEnd, baseTime),
      ).toBe(TaskTimeState.UPCOMING);
    });

    it("boundary test: returns ACTIVE (not UPCOMING) when startDate is exactly now", () => {
      const exactStart = new Date("2026-06-15T12:00:00.000Z");
      const futureEnd = new Date("2026-06-20T00:00:00.000Z");
      expect(
        computeTaskTimeState(TaskStatus.PENDING, exactStart, futureEnd, baseTime),
      ).toBe(TaskTimeState.ACTIVE);
    });

    it("returns ACTIVE when current time is between startDate and endDate", () => {
      const pastStart = new Date("2026-06-01T00:00:00.000Z");
      const futureEnd = new Date("2026-06-20T00:00:00.000Z");
      expect(
        computeTaskTimeState(TaskStatus.IN_PROGRESS, pastStart, futureEnd, baseTime),
      ).toBe(TaskTimeState.ACTIVE);
    });
  });

  describe("checkProjectIsOverdue", () => {
    it("returns false if endDate is null", () => {
      expect(checkProjectIsOverdue(null, ProjectStatus.ACTIVE, baseTime)).toBe(false);
    });

    it("returns false for COMPLETED or ARCHIVED projects even if past endDate", () => {
      const pastEnd = new Date("2026-06-01T00:00:00.000Z");
      expect(
        checkProjectIsOverdue(pastEnd, ProjectStatus.COMPLETED, baseTime),
      ).toBe(false);
      expect(
        checkProjectIsOverdue(pastEnd, ProjectStatus.ARCHIVED, baseTime),
      ).toBe(false);
    });

    it("returns true when endDate is strictly before now for ACTIVE project", () => {
      const pastEnd = new Date("2026-06-15T11:59:59.999Z");
      expect(
        checkProjectIsOverdue(pastEnd, ProjectStatus.ACTIVE, baseTime),
      ).toBe(true);
    });

    it("boundary test: returns false (not overdue) when endDate is exactly now", () => {
      const exactEnd = new Date("2026-06-15T12:00:00.000Z");
      expect(
        checkProjectIsOverdue(exactEnd, ProjectStatus.ACTIVE, baseTime),
      ).toBe(false);
    });
  });
});
