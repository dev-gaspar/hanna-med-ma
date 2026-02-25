import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { DoctorLoginDto } from "./dto/doctor-login.dto";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "User login" })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: "Login successful" })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post("doctor-login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Doctor login" })
  @ApiBody({ type: DoctorLoginDto })
  @ApiResponse({ status: 200, description: "Login successful" })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  doctorLogin(@Body() loginDto: DoctorLoginDto) {
    return this.authService.doctorLogin(loginDto);
  }
}
