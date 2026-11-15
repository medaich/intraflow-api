import { Expose, Type } from "class-transformer";

export class AttachmentUploadedByDto {
  @Expose()
  userId: number;

  @Expose()
  name: string;
}

export class AttachmentResponseDto {
  @Expose()
  attachmentId: number;

  @Expose()
  taskId: number;

  @Expose()
  originalName: string;

  @Expose()
  contentType: string;

  @Expose()
  size: number;

  @Expose()
  createdAt: Date;

  @Expose()
  @Type(() => AttachmentUploadedByDto)
  uploadedBy: AttachmentUploadedByDto | null;
}
