import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateSpecialtyDto {
	@ApiProperty({
		example: "Cardiology",
		description: "Display name (must be unique, case-insensitive).",
	})
	@IsString()
	@IsNotEmpty()
	name: string;

	@ApiProperty({
		example:
			"Specialty delta — CARDIOLOGY\n\nExam scope: ...",
		description:
			"Prompt delta appended after the base coder prompt. Use Markdown. Optional — empty string is fine until the delta is authored.",
		required: false,
	})
	@IsString()
	@IsOptional()
	systemPrompt?: string;
}
