import { Expose } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";

export class PaginationMetaDto {
  @ApiProperty({ description: "Current page number" })
  @Expose()
  page: number;

  @ApiProperty({ description: "Items per page limit" })
  @Expose()
  limit: number;

  @ApiProperty({ description: "Total item count matching filters" })
  @Expose()
  total: number;

  @ApiProperty({ description: "Total page count" })
  @Expose()
  totalPages: number;
}

export class PaginatedResponseDto<T> {
  @ApiProperty({ isArray: true })
  @Expose()
  data: T[];

  @ApiProperty({ type: () => PaginationMetaDto })
  @Expose()
  meta: PaginationMetaDto;

  constructor(data: T[], total: number, page: number, limit: number) {
    this.data = data;
    this.meta = {
      page: Number(page),
      limit: Number(limit),
      total: Number(total),
      totalPages: Math.ceil(total / limit) || 0,
    };
  }
}
