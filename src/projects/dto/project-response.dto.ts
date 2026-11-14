import { Exclude, Expose, Type } from 'class-transformer';
import { ProjectStatus } from '../entities/project.entity';

@Exclude()
export class ProjectProgressDto {
  @Expose()
  completed: number;

  @Expose()
  total: number;

  @Expose()
  percent: number;
}

@Exclude()
export class ProjectResponseDto {
  @Expose()
  projectId: number;

  @Expose()
  name: string;

  @Expose()
  description: string | null;

  @Expose()
  startDate: Date | null;

  @Expose()
  endDate: Date | null;

  @Expose()
  status: ProjectStatus;

  @Expose()
  teamId: number | null;

  @Expose()
  createdBy: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  @Type(() => ProjectProgressDto)
  progress: ProjectProgressDto;

  @Expose()
  isOverdue: boolean;
}
