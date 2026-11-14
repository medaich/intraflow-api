import { Exclude, Expose, Type } from "class-transformer";

@Exclude()
export class CommentUserDto {
  @Expose()
  userId: number;

  @Expose()
  name: string;
}

@Exclude()
export class CommentResponseDto {
  @Expose()
  commentId: number;

  @Expose()
  content: string;

  @Expose()
  isSystem: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  @Type(() => CommentUserDto)
  user: CommentUserDto | null;
}
