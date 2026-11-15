import { Exclude, Expose, Type } from "class-transformer";
import { UserRole } from "../entities/user.entity";
import { TeamMemberRole } from "../../teams/entities/team-membership.entity";

@Exclude()
export class UserMembershipResponseDto {
  @Expose()
  teamId: number;

  @Expose()
  role: TeamMemberRole;
}

@Exclude()
export class UserResponseDto {
  @Expose()
  userId: number;

  @Expose()
  name: string;

  @Expose()
  email: string;

  @Expose()
  role: UserRole;

  @Expose()
  @Type(() => UserMembershipResponseDto)
  membership: UserMembershipResponseDto | null;

  @Expose()
  createdAt: Date;
}
