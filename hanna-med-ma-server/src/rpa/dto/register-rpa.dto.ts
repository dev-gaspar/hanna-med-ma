import { IsString, IsOptional, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RegisterRpaDto {
  @ApiProperty({ example: "a1b2c3-uuid-here", description: "RPA node UUID" })
  @IsString()
  @IsNotEmpty()
  uuid: string;

  @ApiProperty({
    example: "DESKTOP-ABC123",
    description: "Hostname of the RPA machine",
    required: false,
  })
  @IsString()
  @IsOptional()
  hostname?: string;
}
