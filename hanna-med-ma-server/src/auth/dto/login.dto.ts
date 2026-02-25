import { IsString, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
  @ApiProperty({ example: "admin", description: "Username" })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: "password123", description: "Password" })
  @IsString()
  @IsNotEmpty()
  password: string;
}
