import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import { Comment } from "./comment.entity";

export enum TaskStatus {
  UNASSIGNED = "UNASSIGNED",
  // UPCOMING - derived
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  IN_REVIEW = "IN_REVIEW",
  COMPLETED = "COMPLETED",
  // OVERDUE - derived
}

@Entity("tasks")
export class Task {
  constructor(task: Partial<Task>) {
    Object.assign(this, task);
  }

  @PrimaryGeneratedColumn({ name: "task_id" })
  taskId: number;

  @ManyToOne(() => User, (User) => User.tasks, { eager: true })
  @JoinColumn({ name: "assigned_to" })
  assignedTo: User | null;

  @OneToMany(() => Comment, (Comment) => Comment.task)
  comments: Comment[] | null;

  @Column()
  name: string;

  @Column("text", { nullable: true })
  description: string | null;

  @Column({ name: "start_date" })
  startDate: Date;

  @Column({ name: "end_date" })
  endDate: Date;

  @Column({ name: "started_at", type: "timestamp", nullable: true })
  startedAt: Date | null;

  @Column({
    type: "timestamp",
    name: "submitted_at",
  })
  submittedAt: Date | null;

  @Column({
    type: "timestamp",
    name: "completed_at",
  })
  completedAt: Date | null;

  @Column({
    type: "enum",
    enum: TaskStatus,
    default: TaskStatus.UNASSIGNED,
  })
  status: TaskStatus;

  @CreateDateColumn({
    type: "timestamp",
    name: "created_at",
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: "timestamp",
    name: "updated_at",
  })
  updatedAt: Date | null;

  @DeleteDateColumn({
    type: "timestamp",
    name: "deleted_at",
  })
  deletedAt: Date | null;
}
