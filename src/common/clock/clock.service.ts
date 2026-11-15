import { Injectable } from "@nestjs/common";

@Injectable()
export class ClockService {
  private fixedDate: Date | null = null;

  now(): Date {
    return this.fixedDate ? new Date(this.fixedDate) : new Date();
  }

  setFixedTime(date: Date | string | null): void {
    this.fixedDate = date ? new Date(date) : null;
  }

  reset(): void {
    this.fixedDate = null;
  }
}
