import { IsString, IsEmail, IsNotEmpty, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateUserDto {
  @ApiProperty({ example: "John Doe", description: "Full name" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: "doctor", description: "User role" })
  @IsString()
  @IsNotEmpty()
  rol: string;

  @ApiProperty({ example: "johndoe", description: "Username" })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    example: "password123",
    description: "Password (min 6 characters)",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: "john@example.com", description: "Email address" })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
