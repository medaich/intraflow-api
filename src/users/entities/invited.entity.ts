import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { UserRole } from "./user.entity";
import { Team } from "../../teams/entities/team.entity";

@Entity("invited")
export class Invited {
  constructor(invited?: Partial<Invited>) {
    if (invited) {
      Object.assign(this, invited);
    }
  }

  @PrimaryGeneratedColumn("uuid")
  token: string;

  @Index("IDX_INVITED_EMAIL")
  @Column()
  email: string;

  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.EMPLOYEE,
  })
  role: UserRole;

  @Column({ name: "team_id", type: "int", nullable: true })
  teamId: number | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "team_id" })
  team?: Team | null;

  @CreateDateColumn({ type: "timestamp", precision: 6, name: "created_at" })
  createdAt: Date;

  @Column({ type: "timestamp", name: "expires_at" })
  expiresAt: Date;
}
