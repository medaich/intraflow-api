import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { EntityManager, Repository } from "typeorm";
import { User } from "./entities/user.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Invited } from "./entities/invited.entity";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Invited)
    private readonly invitedRepo: Repository<Invited>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly entityManager: EntityManager,

    private readonly configService: ConfigService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const user = new User(createUserDto);
    return this.entityManager.save(user);
  }

  async findAll() {
    const users = await this.usersRepository.find();
    if (users)
      return users.map((user) => new User({ ...user, password: undefined }));
    throw new NotFoundException();
  }

  async findOne({ userId, email }: { userId?: number; email?: string }) {
    if (!userId && !email) return null;
    let user: User | null = null;

    if (userId) {
      user = await this.usersRepository.findOneBy({ userId });
      if (!user) throw new NotFoundException("No user found!");
      return new User({ ...user, password: undefined });
    }

    if (email) user = await this.usersRepository.findOneBy({ email });
    return user;
  }

  async update(userId: number, updateUserDto: UpdateUserDto) {
    return this.usersRepository.update(userId, updateUserDto);
  }

  async remove(userId: number) {
    return this.usersRepository.softDelete(userId);
  }

  async invite(email: string) {
    const pastInvites = await this.invitedRepo.find({
      where: {
        email,
      },
      order: {
        expiresAt: "DESC",
      },
    });

    const hasValidInvite = pastInvites[0]?.expiresAt > new Date();
    if (hasValidInvite)
      throw new ConflictException(
        "A valid invite already exists for this email",
      );

    const userWithEmail = await this.findOne({ email });
    if (userWithEmail)
      throw new ConflictException("This email is already registered");

    const expiration = Number(this.configService.get("TOKEN_EXPIRATION")) || 0;
    const expiresAt = new Date(Date.now() + expiration * 60 * 1000);

    const invited = this.invitedRepo.create({
      email,
      expiresAt,
    });

    return this.invitedRepo.save(invited);
  }

  async checkInvite(token: string, email: string) {
    const invited = await this.invitedRepo.findOneBy({ token });

    if (!invited) throw new NotFoundException();

    if (email !== invited.email) throw new BadRequestException("Invalid email");

    const now = new Date();

    if (now >= invited.expiresAt) throw new NotFoundException("Expired");

    await this.invitedRepo.delete(token);

    return true;
  }
}
