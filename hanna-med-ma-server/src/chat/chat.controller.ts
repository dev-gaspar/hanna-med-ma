import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from "@nestjs/swagger";
import { ChatService } from "./chat.service";
import { CreateMessageDto } from "./dto/create-message.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MessageRole } from "@prisma/client";

@ApiTags("Chat")
@Controller("chat")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @ApiOperation({ summary: "Get doctor chat session and history" })
  @ApiResponse({ status: 200, description: "Chat session with messages" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: Number })
  async getSession(
    @Request() req,
    @Query("limit") limit?: number,
    @Query("cursor") cursor?: number,
  ) {
    const doctorId = req.user.userId;
    return this.chatService.getSession(
      doctorId,
      limit ? Number(limit) : undefined,
      cursor ? Number(cursor) : undefined,
    );
  }

  @Post()
  @ApiOperation({ summary: "Send a message (HTTP fallback)" })
  @ApiBody({ type: CreateMessageDto })
  @ApiResponse({ status: 201, description: "Message sent successfully" })
  async sendMessage(
    @Request() req,
    @Body() createMessageDto: CreateMessageDto,
  ) {
    const doctorId = req.user.userId;
    return this.chatService.createMessage(
      doctorId,
      createMessageDto.content,
      MessageRole.USER,
    );
  }
}
