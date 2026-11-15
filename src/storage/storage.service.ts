import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";

export abstract class StorageService {
  abstract put(key: string, buffer: Buffer): Promise<void>;
  abstract getStream(key: string): Promise<Readable>;
  abstract delete(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
}

@Injectable()
export class LocalDiskStorage implements StorageService {
  private readonly storageDir: string;

  constructor(private readonly configService: ConfigService) {
    this.storageDir = path.resolve(
      this.configService.get<string>("STORAGE_DIR", "./storage"),
    );
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private resolveKey(key: string): string {
    const sanitizedKey = path.basename(key);
    const resolvedPath = path.resolve(this.storageDir, sanitizedKey);
    if (!resolvedPath.startsWith(this.storageDir)) {
      throw new BadRequestException("Path traversal attempt detected");
    }
    return resolvedPath;
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    const fullPath = this.resolveKey(key);
    await fs.promises.writeFile(fullPath, buffer);
  }

  async getStream(key: string): Promise<Readable> {
    const fullPath = this.resolveKey(key);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException("Stored attachment file not found");
    }
    return Promise.resolve(fs.createReadStream(fullPath));
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.resolveKey(key);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.resolveKey(key);
    return Promise.resolve(fs.existsSync(fullPath));
  }
}
