import { IsString, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RegisterTokenDto {
  @ApiProperty({
    description: "FCM token from the client",
    example: "fcm-token-string",
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
