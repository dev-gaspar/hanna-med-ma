import {
  IsString,
  IsEnum,
  IsObject,
  IsArray,
  IsOptional,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";

export enum IngestDataType {
  PATIENT_LIST = "patient_list",
  PATIENT_SUMMARY = "patient_summary",
  PATIENT_INSURANCE = "patient_insurance",
}

export enum HospitalType {
  JACKSON = "JACKSON",
  STEWARD = "STEWARD",
  BAPTIST = "BAPTIST",
}

export class IngestDataDto {
  @ApiProperty({ example: "a1b2c3-uuid", description: "RPA node UUID" })
  @IsString()
  uuid: string;

  @ApiProperty({
    enum: IngestDataType,
    description: "Type of data being ingested",
  })
  @IsEnum(IngestDataType)
  dataType: IngestDataType;

  @ApiProperty({ enum: HospitalType, description: "Hospital EMR system" })
  @IsEnum(HospitalType)
  hospitalType: HospitalType;

  @ApiProperty({ description: "Payload containing extracted data" })
  @IsObject()
  payload: any;
}

export class IngestErrorDto {
  @ApiProperty({ description: "RPA node UUID" })
  @IsString()
  uuid: string;

  @ApiProperty({ description: "Hospital type where error occurred" })
  @IsString()
  hospitalType: string;

  @ApiProperty({ description: "Error message" })
  @IsString()
  error: string;

  @ApiProperty({ description: "Screenshot URL", required: false })
  @IsString()
  @IsOptional()
  screenshotUrl?: string;
}
