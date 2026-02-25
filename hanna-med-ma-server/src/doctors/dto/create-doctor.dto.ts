import { IsString, IsOptional, IsNotEmpty, IsArray } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateDoctorDto {
  @ApiProperty({ example: "Dr. Jane Smith", description: "Doctor name" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: "dr.smith", description: "Doctor username" })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: "securePassword123", description: "Doctor password" })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({
    example: "Cardiology",
    description: "Doctor specialty",
    required: false,
  })
  @IsString()
  @IsOptional()
  specialty?: string;

  @ApiProperty({
    example: ["JACKSON", "STEWARD", "BAPTIST"],
    description: "EMR systems this doctor has access to",
    required: false,
    isArray: true,
    type: String,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  emrSystems?: string[];
}
