import { IsString, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateMessageDto {
  @ApiProperty({
    example: "Hello, how can I help?",
    description: "Message content",
  })
  @IsString()
  @IsNotEmpty()
  content: string;
}
