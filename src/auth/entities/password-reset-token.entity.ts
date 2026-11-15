import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";

@Index("idx_password_reset_tokens_token_hash", ["tokenHash"])
@Index("idx_password_reset_tokens_user_id", ["userId"])
@Entity("password_reset_tokens")
export class PasswordResetToken {
  constructor(partial?: Partial<PasswordResetToken>) {
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

  @Column({ name: "token_hash", length: 64 })
  tokenHash: string;

  @Column({ name: "expires_at", type: "timestamp", precision: 6 })
  expiresAt: Date;

  @Column({ name: "used_at", type: "timestamp", precision: 6, nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 6 })
  createdAt: Date;
}
