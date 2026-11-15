import { UnsupportedMediaTypeException } from "@nestjs/common";
import * as path from "path";

/**
 * Validates and detects MIME content type based on binary inspection.
 * Allowed: PDF, PNG, JPEG, WEBP, plain text, CSV.
 * SVG, HTML, and binary executables are strictly rejected (415).
 */
export function detectAllowedContentType(
  buffer: Buffer,
  originalName?: string,
): string {
  if (!buffer || buffer.length === 0) {
    throw new UnsupportedMediaTypeException("Empty file payload");
  }

  // 1. PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
  ) {
    return "application/pdf";
  }

  // 2. PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }

  // 3. JPEG: 0xFF 0xD8 0xFF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  // 4. WEBP: RIFF....WEBP (0x52 0x49 0x46 0x46 ... 0x57 0x42 0x50)
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  // 5. SVG / HTML forbidden: check for SVG, HTML, XML tags
  const firstKb = buffer
    .subarray(0, Math.min(buffer.length, 1024))
    .toString("utf8")
    .toLowerCase();

  if (
    firstKb.includes("<svg") ||
    firstKb.includes("<html") ||
    firstKb.includes("<!doctype") ||
    firstKb.includes("<script")
  ) {
    throw new UnsupportedMediaTypeException("SVG and HTML files are not permitted");
  }

  // 6. Text / CSV: must be valid UTF-8, no NUL bytes (0x00)
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x00) {
      throw new UnsupportedMediaTypeException("Binary executable or unsupported format");
    }
  }

  const text = buffer.toString("utf8");
  if (Buffer.from(text, "utf8").equals(buffer)) {
    if (originalName?.toLowerCase().endsWith(".csv")) {
      return "text/csv";
    }
    return "text/plain";
  }

  throw new UnsupportedMediaTypeException("Unsupported file content type");
}

export function sanitizeFilename(filename: string): string {
  const base = path.basename(filename);
  /* eslint-disable-next-line no-control-regex */
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.slice(0, 255) || "unnamed-attachment";
}
