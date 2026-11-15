import { BadRequestException } from "@nestjs/common";
import { parseSort } from "./sort-parser";

describe("sort-parser Unit Tests", () => {
  const allowed = ["createdAt", "name", "priority"];

  it("returns null when sort is undefined or empty", () => {
    expect(parseSort(undefined, allowed)).toBeNull();
    expect(parseSort("", allowed)).toBeNull();
  });

  it("parses valid field:asc and field:desc correctly", () => {
    expect(parseSort("name:asc", allowed)).toEqual({ field: "name", direction: "ASC" });
    expect(parseSort("createdAt:desc", allowed)).toEqual({ field: "createdAt", direction: "DESC" });
    expect(parseSort("priority:ASC", allowed)).toEqual({ field: "priority", direction: "ASC" });
  });

  it("throws 400 BadRequestException on invalid format (missing colon or extra colons)", () => {
    expect(() => parseSort("name", allowed)).toThrow(BadRequestException);
    expect(() => parseSort("name:asc:extra", allowed)).toThrow(BadRequestException);
  });

  it("throws 400 BadRequestException on disallowed field", () => {
    expect(() => parseSort("unknownField:asc", allowed)).toThrow(BadRequestException);
  });

  it("throws 400 BadRequestException on invalid direction", () => {
    expect(() => parseSort("name:invalid", allowed)).toThrow(BadRequestException);
  });
});
