import {
  BinaryLike,
  ScryptOptions,
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
} from "crypto";

const scryptAsync = (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options?: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    if (options) {
      _scrypt(password, salt, keylen, options, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    } else {
      _scrypt(password, salt, keylen, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    }
  });

export const DUMMY_HASH =
  "v2.0123456789abcdef0123456789abcdef.a8f5b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `v2.${salt}.${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedPasswordHash: string,
): Promise<boolean> {
  try {
    const parts = storedPasswordHash.split(".");
    if (parts.length === 3 && parts[0] === "v2") {
      const [, salt, expectedHashHex] = parts;
      const computedHash = await scryptAsync(password, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
      });
      const expectedBuf = Buffer.from(expectedHashHex, "hex");
      if (computedHash.length !== expectedBuf.length) {
        return false;
      }
      return timingSafeEqual(computedHash, expectedBuf);
    } else if (parts.length === 2) {
      // Legacy backward-compatible format: <salt>.<hash> (32 bytes)
      const [salt, expectedHashHex] = parts;
      const computedHash = await scryptAsync(password, salt, 32);
      const expectedBuf = Buffer.from(expectedHashHex, "hex");
      if (computedHash.length !== expectedBuf.length) {
        return false;
      }
      return timingSafeEqual(computedHash, expectedBuf);
    }
    return false;
  } catch {
    return false;
  }
}
