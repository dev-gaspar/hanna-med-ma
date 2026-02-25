import { PartialType } from "@nestjs/mapped-types";
import { CreateCredentialDto } from "./create-credential.dto";
import { IsObject, IsOptional } from "class-validator";

export class UpdateCredentialDto extends PartialType(CreateCredentialDto) {
  @IsObject()
  @IsOptional()
  fields?: Record<string, string>;
}
