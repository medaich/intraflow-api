import { BadRequestException } from "@nestjs/common";

export interface ParsedSort {
  field: string;
  direction: "ASC" | "DESC";
}

export function parseSort(
  sort: string | undefined,
  allowedFields: string[],
): ParsedSort | null {
  if (!sort) {
    return null;
  }

  const parts = sort.split(":");
  if (parts.length !== 2) {
    throw new BadRequestException("Invalid sort format. Expected field:asc or field:desc");
  }

  const [field, rawDir] = parts;
  if (!allowedFields.includes(field)) {
    throw new BadRequestException(
      `Invalid sort field '${field}'. Allowed fields: ${allowedFields.join(", ")}`,
    );
  }

  const direction = rawDir.toUpperCase();
  if (direction !== "ASC" && direction !== "DESC") {
    throw new BadRequestException(
      `Invalid sort direction '${rawDir}'. Allowed directions: asc, desc`,
    );
  }

  return { field, direction: direction };
}
