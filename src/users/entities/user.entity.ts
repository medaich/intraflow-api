import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from "typeorm";
import { Task } from "../../tasks/entities/task.entity";
import { Comment } from "../../tasks/entities/comment.entity";

export enum UserRole {
  EMPLOYEE = "EMPLOYEE",
  ADMIN = "ADMIN",
}

@Entity("users")
export class User {
  constructor(user: Partial<User>) {
    Object.assign(this, user);
  }

  @PrimaryGeneratedColumn({ name: "user_id" })
  userId: number;

  @OneToMany(() => Task, (Task) => Task.assignedTo)
  tasks: Task[];

  @OneToMany(() => Comment, (Comment) => Comment.user)
  comments: Comment[];

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: "birth_date", type: "date", nullable: true })
  birthDate: Date;

  @Column({ name: "image_path", nullable: true })
  imagePath: string;

  @Column()
  password: string;

  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.EMPLOYEE,
  })
  role: UserRole;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updatedAt: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamp", nullable: true })
  deletedAt: Date;
}
