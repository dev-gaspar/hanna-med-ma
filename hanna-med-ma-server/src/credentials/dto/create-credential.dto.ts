import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsString,
  IsIn,
  IsOptional,
} from "class-validator";
import { VALID_SYSTEM_KEYS, SystemKey } from "../systems.config";

export class CreateCredentialDto {
  @IsNumber()
  @IsNotEmpty()
  doctorId: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_SYSTEM_KEYS)
  systemKey: SystemKey;

  @IsObject()
  @IsOptional()
  fields?: Record<string, string> = {};
}
