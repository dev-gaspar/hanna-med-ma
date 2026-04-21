import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";
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
    example: 3,
    description:
      "Specialty relation ID (preferred). When set, Doctor.specialty string is auto-synced from Specialty.name.",
    required: false,
  })
  @IsInt()
  @IsOptional()
  specialtyId?: number;

  @ApiProperty({
    example: "Cardiology",
    description:
      "Legacy free-text specialty. Kept for back-compat; ignored when specialtyId is provided.",
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
