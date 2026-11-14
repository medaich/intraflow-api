import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import { UserRole } from "./user.entity";

@Entity("invited")
export class Invited {
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

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;

  @Column({ type: "timestamp", name: "expires_at" })
  expiresAt: Date;
}
