import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import { Task } from "./task.entity";

@Entity()
export class Comment {
  constructor(comment: Partial<Comment>) {
    Object.assign(this, comment);
  }

  @PrimaryGeneratedColumn({ name: "comment_id" })
  commentId: number;

  @ManyToOne(() => User, (User) => User.comments)
  @JoinColumn()
  user: User | null;

  @ManyToOne(() => Task, (Task) => Task.comments)
  @JoinColumn()
  task: Task | null;

  @Column("text")
  content: string;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updatedAt: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamp" })
  deletedAt: Date;
}
