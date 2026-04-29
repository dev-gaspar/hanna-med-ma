import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from "class-validator";

export class CreateSpecialtyDto {
  @ApiProperty({
    example: "Cardiology",
    description: "Display name (must be unique, case-insensitive).",
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: "Specialty delta — CARDIOLOGY\n\nExam scope: ...",
    description:
      "Prompt delta appended after the base coder prompt. Use Markdown. Optional — empty string is fine until the delta is authored.",
    required: false,
  })
  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @ApiProperty({
    example: ["21", "22", "11", "23", "24"],
    description:
      "Ordered list of CMS POS codes shown as quick-pick buttons in the doctor's 'Mark as seen' modal. Each code must match an active row in place_of_service_codes. Empty array means 'no shortcuts; doctor picks from the full list'.",
    required: false,
    type: [String],
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[0-9]{2}$/, { each: true })
  @IsOptional()
  commonPosCodes?: string[];

  @ApiProperty({
    example: "21",
    description:
      "POS code pre-selected when the modal opens. Must be either null (no pre-fill) or one of the codes listed in commonPosCodes.",
    required: false,
    nullable: true,
  })
  @ValidateIf((o) => o.defaultPosCode !== null)
  @IsString()
  @Matches(/^[0-9]{2}$/)
  @IsOptional()
  defaultPosCode?: string | null;
}
