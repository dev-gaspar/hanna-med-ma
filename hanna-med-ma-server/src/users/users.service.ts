import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../core/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import * as bcrypt from "bcrypt";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    // Check if user already exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: createUserDto.username },
          { email: createUserDto.email },
        ],
      },
    });

    if (existingUser) {
      throw new ConflictException("Username or email already exists");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    return this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        rol: true,
        username: true,
        email: true,
        deleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: {
        deleted: false,
      },
      select: {
        id: true,
        name: true,
        rol: true,
        username: true,
        email: true,
        deleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deleted: false,
      },
      select: {
        id: true,
        name: true,
        rol: true,
        username: true,
        email: true,
        deleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByUsername(username: string) {
    return this.prisma.user.findFirst({
      where: {
        username,
        deleted: false,
      },
    });
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user || user.deleted) {
      throw new NotFoundException(
        `User with ID ${id} not found or has been deleted`,
      );
    } // Check if exists

    const data: any = { ...updateUserDto };

    // Hash password if provided
    if (updateUserDto.password) {
      data.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        rol: true,
        username: true,
        email: true,
        deleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async remove(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user || user.deleted) {
      throw new NotFoundException(
        `User with ID ${id} not found or has been deleted`,
      );
    }

    return this.prisma.user.update({
      where: { id },
      data: { deleted: true },
      select: {
        id: true,
        name: true,
        rol: true,
        username: true,
        email: true,
        deleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
