import { UserRole } from "../../users/entities/user.entity";

export interface SessionData {
  userId: number | null;
  role: UserRole | null;
  iat?: number | null;
}
