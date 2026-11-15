import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "../../users/entities/user.entity";
import { Comment } from "./comment.entity";
import { Project } from "../../projects/entities/project.entity";
import { Attachment } from "./attachment.entity";

export enum TaskStatus {
  UNASSIGNED = "UNASSIGNED",
  // UPCOMING - derived
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  IN_REVIEW = "IN_REVIEW",
  COMPLETED = "COMPLETED",
  // OVERDUE - derived
}

export enum TaskPriority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  URGENT = "URGENT",
}

@Index("idx_tasks_status", ["status"])
@Index("idx_tasks_dates", ["endDate", "startDate"])
@Index("idx_tasks_priority", ["priority"])
@Index("idx_tasks_project_status", ["projectId", "status"])
@Index("idx_tasks_assigned_to", ["assignedTo"])
@Index("idx_tasks_name", ["name"])
@Entity("tasks")
export class Task {
  constructor(task?: Partial<Task>) {
    if (task) {
      Object.assign(this, task);
    }
  }

  @PrimaryGeneratedColumn({ name: "task_id" })
  taskId: number;

  @ManyToOne(() => User, (User) => User.tasks, { eager: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assigned_to" })
  assignedTo: User | null;

  @OneToMany(() => Comment, (Comment) => Comment.task)
  comments: Comment[] | null;

  @OneToMany(() => Attachment, (attachment) => attachment.task)
  attachments: Attachment[];

  @Column({ name: "project_id", type: "int", nullable: true })
  projectId: number | null;

  @ManyToOne(() => Project, (project) => project.tasks, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "project_id" })
  project: Project | null;

  @ManyToMany(() => Task, (task) => task.dependentTasks)
  @JoinTable({
    name: "task_dependencies",
    joinColumn: { name: "task_id", referencedColumnName: "taskId" },
    inverseJoinColumn: { name: "depends_on_task_id", referencedColumnName: "taskId" },
  })
  dependsOn: Task[];

  @ManyToMany(() => Task, (task) => task.dependsOn)
  dependentTasks: Task[];

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
    nullable: true,
  })
  submittedAt: Date | null;

  @Column({
    type: "timestamp",
    name: "completed_at",
    nullable: true,
  })
  completedAt: Date | null;

  @Column({
    type: "enum",
    enum: TaskStatus,
    default: TaskStatus.UNASSIGNED,
  })
  status: TaskStatus;

  @Column({
    type: "enum",
    enum: TaskPriority,
    default: TaskPriority.MEDIUM,
  })
  priority: TaskPriority;

  @CreateDateColumn({
    type: "timestamp",
    precision: 6,
    name: "created_at",
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: "timestamp",
    precision: 6,
    name: "updated_at",
  })
  updatedAt: Date | null;

  @DeleteDateColumn({
    type: "timestamp",
    precision: 6,
    name: "deleted_at",
  })
  deletedAt: Date | null;
}
