import { IsString, IsNotEmpty, IsOptional, IsEnum } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { MessageType } from "@prisma/client";

export class CreateAiMessageDto {
  @ApiProperty({ example: "1", description: "Doctor ID (string or number)" })
  @IsNotEmpty()
  doctorId: string | number;

  @ApiProperty({
    example: "Here is the patient summary...",
    description: "Message content",
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    example: "TEXT",
    description: "Message type (optional, defaults to TEXT)",
    enum: MessageType,
    required: false,
  })
  @IsOptional()
  @IsEnum(MessageType)
  typeMessage?: MessageType;
}
