import {
	IsString,
	IsNotEmpty,
	IsArray,
	IsOptional,
	ArrayMinSize,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SendNotificationDto {
	@ApiProperty({
		description: "Notification title",
		example: "System Update",
	})
	@IsString()
	@IsNotEmpty()
	title: string;

	@ApiProperty({
		description: "Notification body/message",
		example: "A new version of the app is available.",
	})
	@IsString()
	@IsNotEmpty()
	body: string;

	@ApiPropertyOptional({
		description:
			"Array of doctor IDs to notify. If omitted or empty, sends to ALL doctors with active tokens.",
		example: [1, 2, 3],
		type: [Number],
	})
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	doctorIds?: number[];
}
