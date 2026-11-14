import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { UsersService } from "src/users/users.service";
import {
  BinaryLike,
  ScryptOptions,
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
} from "crypto";
import { SigninDto } from "./dto/signin.dto";
import { SignupDto } from "./dto/signup.dto";
import { User } from "src/users/entities/user.entity";

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

@Injectable()
export class AuthService {
  // Precomputed dummy hash so scrypt always runs with equal cost on missing users
  private readonly dummyHash =
    "v2.0123456789abcdef0123456789abcdef.a8f5b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7";

  constructor(private usersService: UsersService) {}

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const hash = await scryptAsync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
    });
    return `v2.${salt}.${hash.toString("hex")}`;
  }

  async verifyPassword(
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

  async signup(token: string, signupDto: SignupDto): Promise<User> {
    const hashedPassword = await this.hashPassword(signupDto.password);
    return this.usersService.registerWithInvite(token, signupDto, hashedPassword);
  }

  async signin(signinDto: SigninDto): Promise<User> {
    const { email, password } = signinDto;

    const user = await this.usersService.findByEmailWithPassword(email.toLowerCase());

    if (!user) {
      // Burn equal CPU cycles with dummy scrypt verification to prevent timing attacks
      await this.verifyPassword(password, this.dummyHash);
      throw new UnauthorizedException("Invalid credentials");
    }

    const isValid = await this.verifyPassword(password, user.password);
    if (!isValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return user;
  }
}
