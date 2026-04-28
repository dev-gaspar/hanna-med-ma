import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export const PAYER_EM_CATEGORIES = [
  "ALWAYS_INITIAL_HOSPITAL",
  "ALWAYS_CONSULT",
  "DEPENDS_HUMAN_REVIEW",
] as const;
export type PayerEMCategoryDto = (typeof PAYER_EM_CATEGORIES)[number];

export class CreatePayerEMRuleDto {
  @ApiProperty({ example: "Oscar Health" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  payerName!: string;

  @ApiPropertyOptional({
    example: "(?i)oscar.*health",
    description: "Optional regex/glob — used as last-resort match step.",
  })
  @IsOptional()
  @IsString()
  payerPattern?: string | null;

  @ApiProperty({ enum: PAYER_EM_CATEGORIES, example: "ALWAYS_CONSULT" })
  @IsEnum(PAYER_EM_CATEGORIES)
  category!: PayerEMCategoryDto;

  @ApiPropertyOptional({
    example: null,
    description:
      "Inclusive lower age bound. Null = no lower bound (e.g. Self-Pay <65 has ageMin=null, ageMax=64).",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  ageMin?: number | null;

  @ApiPropertyOptional({ example: 64 })
  @IsOptional()
  @IsInt()
  @Min(0)
  ageMax?: number | null;

  @ApiPropertyOptional({
    example: 1,
    description:
      "FK to a Practice. Null = global default applied across every practice.",
  })
  @IsOptional()
  @IsInt()
  practiceId?: number | null;

  @ApiPropertyOptional({ example: "Hajira 2026-04-27 calibration doc" })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ example: "Hajira 2026-04-27 calibration doc" })
  @IsOptional()
  @IsString()
  source?: string | null;
}

export class UpdatePayerEMRuleDto {
  @ApiPropertyOptional({ example: "Oscar Health" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  payerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payerPattern?: string | null;

  @ApiPropertyOptional({ enum: PAYER_EM_CATEGORIES })
  @IsOptional()
  @IsEnum(PAYER_EM_CATEGORIES)
  category?: PayerEMCategoryDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  ageMin?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  ageMax?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  practiceId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string | null;
}
