import {
	Controller,
	Post,
	Delete,
	Body,
	UseGuards,
	Request,
	UnauthorizedException,
	ServiceUnavailableException,
} from "@nestjs/common";
import {
	ApiTags,
	ApiOperation,
	ApiResponse,
	ApiBearerAuth,
	ApiBody,
} from "@nestjs/swagger";
import { FcmService } from "./fcm.service";
import { RegisterTokenDto } from "./dto/register-token.dto";
import { SendNotificationDto } from "./dto/send-notification.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Notifications")
@Controller("notifications")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class NotificationsController {
	constructor(private readonly fcmService: FcmService) {}

	@Post("register-token")
	@ApiOperation({ summary: "Register FCM token for push notifications" })
	@ApiBody({ type: RegisterTokenDto })
	@ApiResponse({ status: 201, description: "Token registered successfully" })
	@ApiResponse({ status: 401, description: "Unauthorized" })
	async registerToken(@Request() req, @Body() dto: RegisterTokenDto) {
		const doctorId = req.user?.userId;

		if (!doctorId) {
			throw new UnauthorizedException("Invalid token");
		}

		await this.fcmService.registerToken(doctorId, dto.token);
		return { success: true, message: "FCM token registered" };
	}

	@Delete("unregister-token")
	@ApiOperation({ summary: "Unregister FCM token" })
	@ApiBody({ type: RegisterTokenDto })
	@ApiResponse({ status: 200, description: "Token unregistered successfully" })
	async unregisterToken(@Body() dto: RegisterTokenDto) {
		await this.fcmService.deactivateToken(dto.token);
		return { success: true, message: "FCM token unregistered" };
	}

	@Post("send")
	@ApiOperation({
		summary: "Send push notification to doctors (admin broadcast)",
	})
	@ApiBody({ type: SendNotificationDto })
	@ApiResponse({ status: 201, description: "Notification sent" })
	@ApiResponse({ status: 401, description: "Unauthorized" })
	async sendNotification(@Body() dto: SendNotificationDto) {
		if (!this.fcmService.firebaseReady) {
			throw new ServiceUnavailableException(
				"Push notifications are not available. Firebase is not configured on the server.",
			);
		}

		const result = await this.fcmService.sendBroadcastNotification(
			dto.title,
			dto.body,
			dto.doctorIds,
		);

		return {
			success: true,
			message: `Notification sent to ${result.totalDoctors} doctor(s)`,
			...result,
		};
	}
}
