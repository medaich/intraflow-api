import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UsersService } from "src/users/users.service";
import { randomBytes, scrypt as _scrypt } from "crypto";
import { promisify } from "util";
import { SigninDto } from "./dto/signin.dto";
import { SignupDto } from "./dto/signup.dto";
import { User } from "src/users/entities/user.entity";

const scrypt = promisify(_scrypt);

@Injectable()
export class AuthService {
  constructor(private usersService: UsersService) {}

  async signup(signupDto: SignupDto) {
    const { email, password } = signupDto;
    let user = await this.usersService.findOne({ email });

    if (user) throw new BadRequestException("email already exist");

    const salt = randomBytes(8).toString("hex");
    const hash = (await scrypt(password, salt, 32)) as Buffer;
    const result = salt + "." + hash.toString("hex");

    user = new User({ ...signupDto, password: result });

    const newUser = await this.usersService.create(user);
    return { ...newUser, password: undefined };
  }

  async signin(signinDto: SigninDto) {
    const { email, password } = signinDto;

    const user = await this.usersService.findOne({ email });
    if (!user) throw new NotFoundException();

    const { password: hashedSaltedPassword, ...currUser } = user;
    const [salt, hashedPassword] = hashedSaltedPassword.split(".");

    const newHash = (await scrypt(password, salt, 32)) as Buffer;
    if (hashedPassword !== newHash.toString("hex"))
      throw new BadRequestException("Bad password");

    return currUser;
  }
}
