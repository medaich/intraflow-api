import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./user.entity";

@Index("idx_email_change_requests_token_hash", ["tokenHash"])
@Index("idx_email_change_requests_user_id", ["userId"])
@Entity("email_change_requests")
export class EmailChangeRequest {
  constructor(partial?: Partial<EmailChangeRequest>) {
    if (partial) {
      Object.assign(this, partial);
    }
  }

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "user_id" })
  userId: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "new_email", length: 255 })
  newEmail: string;

  @Column({ name: "token_hash", length: 64 })
  tokenHash: string;

  @Column({ name: "expires_at", type: "timestamp", precision: 6 })
  expiresAt: Date;

  @Column({ name: "used_at", type: "timestamp", precision: 6, nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 6 })
  createdAt: Date;
}
