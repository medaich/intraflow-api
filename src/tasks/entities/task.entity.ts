import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
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
