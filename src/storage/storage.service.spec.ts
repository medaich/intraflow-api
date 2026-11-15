import { NotFoundException, UnsupportedMediaTypeException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { LocalDiskStorage } from "./storage.service";
import { detectAllowedContentType, sanitizeFilename } from "./content-type-sniffer";

describe("StorageService and ContentTypeSniffer", () => {
  const testStorageDir = path.resolve("./test-unit-storage");

  beforeAll(() => {
    if (!fs.existsSync(testStorageDir)) {
      fs.mkdirSync(testStorageDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testStorageDir)) {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    }
  });

  describe("LocalDiskStorage", () => {
    let storage: LocalDiskStorage;

    beforeEach(() => {
      const configService = {
        get: jest.fn().mockReturnValue(testStorageDir),
      } as unknown as ConfigService;
      storage = new LocalDiskStorage(configService);
    });

    it("puts, checks exists, gets stream, and deletes file", async () => {
      const key = "test-file.txt";
      const content = Buffer.from("Hello Intraflow Storage");

      expect(await storage.exists(key)).toBe(false);

      await storage.put(key, content);
      expect(await storage.exists(key)).toBe(true);

      const stream = await storage.getStream(key);
      expect(stream).toBeDefined();

      // Read stream content
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      expect(Buffer.concat(chunks).toString("utf8")).toBe("Hello Intraflow Storage");

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
    });

    it("throws NotFoundException when getStream is called for nonexistent file", async () => {
      await expect(storage.getStream("nonexistent.pdf")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("sanitizes path traversal attempts with basename", async () => {
      // path.basename is applied so traversal attempts don't escape storageDir
      const key = "../evil.txt";
      await storage.put(key, Buffer.from("safe"));
      expect(await storage.exists("evil.txt")).toBe(true);
      await storage.delete("evil.txt");
    });
  });

  describe("detectAllowedContentType", () => {
    it("detects PDF", () => {
      const pdf = Buffer.from("%PDF-1.4 sample content");
      expect(detectAllowedContentType(pdf)).toBe("application/pdf");
    });

    it("detects PNG", () => {
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
      ]);
      expect(detectAllowedContentType(png)).toBe("image/png");
    });

    it("detects JPEG", () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(detectAllowedContentType(jpeg)).toBe("image/jpeg");
    });

    it("detects WEBP", () => {
      const webp = Buffer.concat([
        Buffer.from("RIFF"),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from("WEBP"),
      ]);
      expect(detectAllowedContentType(webp)).toBe("image/webp");
    });

    it("detects text/plain and text/csv", () => {
      const txt = Buffer.from("simple text");
      expect(detectAllowedContentType(txt, "notes.txt")).toBe("text/plain");

      const csv = Buffer.from("id,name,role\n1,Alice,ADMIN");
      expect(detectAllowedContentType(csv, "data.csv")).toBe("text/csv");
    });

    it("rejects empty buffer with 415", () => {
      expect(() => detectAllowedContentType(Buffer.alloc(0))).toThrow(
        UnsupportedMediaTypeException,
      );
    });

    it("rejects SVG and HTML payloads with 415", () => {
      const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><circle/></svg>");
      expect(() => detectAllowedContentType(svg, "image.png")).toThrow(
        UnsupportedMediaTypeException,
      );

      const html = Buffer.from("<!DOCTYPE html><html><body><h1>test</h1></body></html>");
      expect(() => detectAllowedContentType(html, "doc.pdf")).toThrow(
        UnsupportedMediaTypeException,
      );
    });

    it("rejects binary executable with NUL bytes with 415", () => {
      const binary = Buffer.from([0x4d, 0x5a, 0x00, 0x03]); // MZ header with null byte
      expect(() => detectAllowedContentType(binary, "app.exe")).toThrow(
        UnsupportedMediaTypeException,
      );
    });
  });

  describe("sanitizeFilename", () => {
    it("strips path traversal and control characters", () => {
      expect(sanitizeFilename("../../secret/report.pdf")).toBe("report.pdf");
      expect(sanitizeFilename("file\x00\x1fname.txt")).toBe("filename.txt");
    });

    it("defaults to unnamed-attachment if empty", () => {
      expect(sanitizeFilename("")).toBe("unnamed-attachment");
      expect(sanitizeFilename("   ")).toBe("unnamed-attachment");
    });
  });
});
