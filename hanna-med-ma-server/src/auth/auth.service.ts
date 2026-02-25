import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UsersService } from "../users/users.service";
import { DoctorsService } from "../doctors/doctors.service";
import { LoginDto } from "./dto/login.dto";
import { DoctorLoginDto } from "./dto/doctor-login.dto";
import * as bcrypt from "bcrypt";
import { JwtPayload } from "./strategies/jwt.strategy";

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private doctorsService: DoctorsService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByUsername(loginDto.username);

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      rol: user.rol,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        rol: user.rol,
      },
    };
  }

  async validateUser(userId: number) {
    return this.usersService.findOne(userId);
  }

  async doctorLogin(loginDto: DoctorLoginDto) {
    const doctor = await this.doctorsService.findByUsername(loginDto.username);

    if (!doctor) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      doctor.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Generate JWT token for doctor with 1h expiry (HIPAA compliance)
    const payload = {
      sub: doctor.id,
      username: doctor.username,
      type: "doctor",
    };

    return {
      access_token: this.jwtService.sign(payload, { expiresIn: "1h" }),
      doctor: {
        id: doctor.id,
        name: doctor.name,
        username: doctor.username,
        specialty: doctor.specialty,
      },
    };
  }
}
