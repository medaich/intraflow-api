import { UserRole } from "src/users/entities/user.entity";

export interface SessionData {
  userId: number | null;
  role: UserRole | null;
}
