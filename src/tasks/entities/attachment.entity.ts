import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Task } from "./task.entity";
import { User } from "../../users/entities/user.entity";

@Index("idx_attachments_task_id", ["taskId"])
@Entity("attachments")
export class Attachment {
  constructor(partial?: Partial<Attachment>) {
    if (partial) {
      Object.assign(this, partial);
    }
  }

  @PrimaryGeneratedColumn({ name: "attachment_id" })
  attachmentId: number;

  @Column({ name: "task_id" })
  taskId: number;

  @ManyToOne(() => Task, (task) => task.attachments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: Task;

  @Column({ name: "uploaded_by", nullable: true })
  uploadedById: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "uploaded_by" })
  uploadedBy: User | null;

  @Column({ name: "original_name", length: 255 })
  originalName: string;

  @Column({ name: "storage_key", length: 255, unique: true })
  storageKey: string;

  @Column({ name: "content_type", length: 100 })
  contentType: string;

  @Column({ type: "int" })
  size: number;

  @CreateDateColumn({
    type: "timestamp",
    precision: 6,
    name: "created_at",
  })
  createdAt: Date;
}
