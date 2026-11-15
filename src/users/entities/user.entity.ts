import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  OneToOne,
} from "typeorm";
import { Task } from "../../tasks/entities/task.entity";
import { Comment } from "../../tasks/entities/comment.entity";
import { TeamMembership } from "../../teams/entities/team-membership.entity";

export enum UserRole {
  EMPLOYEE = "EMPLOYEE",
  ADMIN = "ADMIN",
}

@Index("idx_users_role", ["role"])
@Index("idx_users_name", ["name"])
@Entity("users")
export class User {
  constructor(user?: Partial<User>) {
    if (user) {
      Object.assign(this, user);
    }
  }

  @PrimaryGeneratedColumn({ name: "user_id" })
  userId: number;

  @OneToMany(() => Task, (Task) => Task.assignedTo)
  tasks: Task[];

  @OneToMany(() => Comment, (Comment) => Comment.user)
  comments: Comment[];

  @OneToOne(() => TeamMembership, (membership) => membership.user)
  membership?: TeamMembership | null;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: "birth_date", type: "date", nullable: true })
  birthDate: Date;

  @Column({ name: "image_path", nullable: true })
  imagePath: string;

  @Column({ select: false })
  password: string;

  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.EMPLOYEE,
  })
  role: UserRole;

  @Column({
    name: "sessions_valid_from",
    type: "timestamp",
    precision: 6,
    nullable: true,
  })
  sessionsValidFrom: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp", precision: 6 })
  updatedAt: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamp", precision: 6, nullable: true })
  deletedAt: Date;
}
