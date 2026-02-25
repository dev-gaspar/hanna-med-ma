import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, MinLength } from "class-validator";

export class DoctorLoginDto {
  @ApiProperty({
    description: "Doctor username",
    example: "dr.john",
  })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    description: "Doctor password",
    example: "securePassword123",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
