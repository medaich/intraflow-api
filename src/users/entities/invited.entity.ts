import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity()
export class Invited {
  @PrimaryGeneratedColumn("uuid")
  token: string;

  @Index()
  @Column()
  email: string;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;

  @Column({ type: "timestamp", name: "expires_at" })
  expiresAt: Date;
}
