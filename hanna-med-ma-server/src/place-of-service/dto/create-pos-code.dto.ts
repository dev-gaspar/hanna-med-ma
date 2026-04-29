import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";

export class CreatePlaceOfServiceCodeDto {
  @ApiProperty({
    example: "11",
    description:
      "CMS POS code. Two-character numeric string (the catalog uses '01'-'99' with gaps for unassigned slots).",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{2}$/, { message: "code must be a 2-digit string" })
  code: string;

  @ApiProperty({
    example: "Office",
    description:
      "Canonical name (matches the CMS code-set publication exactly).",
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: "Office",
    description:
      "Short label shown on the encounter modal's quick-pick buttons. Keep ≤14 characters so the button stays compact.",
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 20)
  shortLabel: string;

  @ApiProperty({
    example:
      "Location, other than a hospital, where the health professional routinely provides ambulatory care.",
    description: "CMS-published description (full sentence).",
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    example: true,
    description:
      "Whether the code is currently active. Set to false to retire a code without deleting historical encounters that reference it.",
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
