import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as admin from "firebase-admin";
import * as path from "path";
import * as fs from "fs";
import { PrismaService } from "../core/prisma.service";

@Injectable()
export class FcmService implements OnModuleInit {
	private readonly logger = new Logger(FcmService.name);

	constructor(
		private prisma: PrismaService,
		private configService: ConfigService,
	) {}

	onModuleInit() {
		// Initialize Firebase Admin SDK if not already initialized
		if (!admin.apps.length) {
			let credential: admin.credential.Credential;

			// Check for individual environment variables first (production - more reliable)
			const projectId = this.configService.get<string>(
				"SERVER_FIREBASE_PROJECT_ID",
			);
			const clientEmail = this.configService.get<string>(
				"SERVER_FIREBASE_CLIENT_EMAIL",
			);
			const privateKeyBase64 =
				this.configService.get<string>("SERVER_FIREBASE_PRIVATE_KEY") ||
				this.configService.get<string>("FIREBASE_PRIVATE_KEY");

			if (projectId && clientEmail && privateKeyBase64) {
				// Decode private key from base64
				const privateKey = Buffer.from(privateKeyBase64, "base64").toString(
					"utf-8",
				);

				//exaple code
				/**
				 * $json = Get-Content -Path "firebase\hanna-med-ma-b2639-firebase-adminsdk-fbsvc-6cacc44787.json" -Raw | ConvertFrom-Json; $keyBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json.private_key)); Set-Clipboard $keyBase64; Write-Host "FIREBASE_PRIVATE_KEY copiado al clipboard! (longitud: $($keyBase64.Length) chars)"
				 */

				try {
					credential = admin.credential.cert({
						projectId,
						clientEmail,
						privateKey,
					});
					this.logger.log(
						"Firebase Admin SDK initialized from environment variables",
					);
				} catch (error) {
					this.logger.error(
						`Failed to init FCM from env vars: ${error.message}`,
					);
					return;
				}
			} else {
				// Fallback: Load from file (local development)
				const serviceAccountPath = path.join(
					process.cwd(),
					"firebase",
					"hanna-med-ma-b2639-firebase-adminsdk-fbsvc-6cacc44787.json",
				);

				if (!fs.existsSync(serviceAccountPath)) {
					this.logger.warn(
						"Firebase credentials not found. Push notifications disabled.",
					);
					this.logger.warn(
						"Set SERVER_FIREBASE_PROJECT_ID, SERVER_FIREBASE_CLIENT_EMAIL, SERVER_FIREBASE_PRIVATE_KEY for production",
					);
					return;
				}

				credential = admin.credential.cert(serviceAccountPath);
				this.logger.log("Firebase Admin SDK initialized from file");
			}

			admin.initializeApp({ credential });
		}
	}

	/**
	 * Register or update an FCM token for a doctor
	 */
	async registerToken(doctorId: number, token: string): Promise<void> {
		// Clean up: Deactivate other tokens for this doctor to avoid duplicate notifications on same/multiple devices
		// This enforces a "last device wins" policy. Remove this if you want multi-device support.
		await this.prisma.doctorFcmToken.updateMany({
			where: { doctorId, token: { not: token } },
			data: { isActive: false },
		});

		await this.prisma.doctorFcmToken.upsert({
			where: { token },
			update: {
				doctorId,
				isActive: true,
				updatedAt: new Date(),
			},
			create: {
				doctorId,
				token,
				isActive: true,
			},
		});

		this.logger.log(
			`FCM token registered for doctor ${doctorId} (others deactivated)`,
		);
	}

	/**
	 * Deactivate an FCM token
	 */
	async deactivateToken(token: string): Promise<void> {
		await this.prisma.doctorFcmToken.updateMany({
			where: { token },
			data: { isActive: false },
		});
	}

	/**
	 * Send push notification to a doctor
	 */
	async sendPushNotification(
		doctorId: number,
		title: string,
		body: string,
	): Promise<void> {
		const tokens = await this.prisma.doctorFcmToken.findMany({
			where: {
				doctorId,
				isActive: true,
			},
			select: { token: true },
		});

		if (tokens.length === 0) {
			this.logger.debug(`No active FCM tokens for doctor ${doctorId}`);
			return;
		}

		const tokenList = tokens.map((t) => t.token);

		try {
			const response = await admin.messaging().sendEachForMulticast({
				tokens: tokenList,
				// DATA-ONLY payload: no "notification" key so Firebase won't auto-display.
				// The Service Worker's onBackgroundMessage handler shows the notification.
				data: {
					title,
					body,
					link: "/doctor/chat",
				},
			});

			this.logger.log(
				`Push sent to doctor ${doctorId}: ${response.successCount} success, ${response.failureCount} failures`,
			);

			// Handle failed tokens
			if (response.failureCount > 0) {
				const failedTokens: string[] = [];
				response.responses.forEach((resp, idx) => {
					if (!resp.success) {
						const errorCode = resp.error?.code;
						// Deactivate invalid tokens
						if (
							errorCode === "messaging/invalid-registration-token" ||
							errorCode === "messaging/registration-token-not-registered"
						) {
							failedTokens.push(tokenList[idx]);
						}
					}
				});

				// Deactivate failed tokens
				if (failedTokens.length > 0) {
					await this.prisma.doctorFcmToken.updateMany({
						where: { token: { in: failedTokens } },
						data: { isActive: false },
					});
					this.logger.warn(
						`Deactivated ${failedTokens.length} invalid FCM tokens`,
					);
				}
			}
		} catch (error) {
			this.logger.error(`Error sending push notification: ${error.message}`);
		}
	}

	/**
	 * Send push notification to multiple doctors (broadcast).
	 * If doctorIds is provided, sends only to those doctors.
	 * If omitted, sends to ALL doctors with active tokens.
	 */
	async sendBroadcastNotification(
		title: string,
		body: string,
		doctorIds?: number[],
	): Promise<{
		totalDoctors: number;
		successCount: number;
		failureCount: number;
	}> {
		// Build the query filter
		const whereClause: any = { isActive: true };
		if (doctorIds && doctorIds.length > 0) {
			whereClause.doctorId = { in: doctorIds };
		}

		const tokens = await this.prisma.doctorFcmToken.findMany({
			where: whereClause,
			select: { token: true, doctorId: true },
		});

		if (tokens.length === 0) {
			this.logger.warn("No active FCM tokens found for broadcast");
			return { totalDoctors: 0, successCount: 0, failureCount: 0 };
		}

		const uniqueDoctors = new Set(tokens.map((t) => t.doctorId));
		const tokenList = tokens.map((t) => t.token);

		// Firebase allows max 500 tokens per sendEachForMulticast call
		const BATCH_SIZE = 500;
		let totalSuccess = 0;
		let totalFailure = 0;
		const allFailedTokens: string[] = [];

		for (let i = 0; i < tokenList.length; i += BATCH_SIZE) {
			const batch = tokenList.slice(i, i + BATCH_SIZE);
			try {
				const response = await admin.messaging().sendEachForMulticast({
					tokens: batch,
					data: { title, body, link: "/doctor/chat" },
				});

				totalSuccess += response.successCount;
				totalFailure += response.failureCount;

				if (response.failureCount > 0) {
					response.responses.forEach((resp, idx) => {
						if (!resp.success) {
							const errorCode = resp.error?.code;
							if (
								errorCode === "messaging/invalid-registration-token" ||
								errorCode === "messaging/registration-token-not-registered"
							) {
								allFailedTokens.push(batch[idx]);
							}
						}
					});
				}
			} catch (error) {
				this.logger.error(`Error in broadcast batch: ${error.message}`);
				totalFailure += batch.length;
			}
		}

		// Deactivate failed tokens
		if (allFailedTokens.length > 0) {
			await this.prisma.doctorFcmToken.updateMany({
				where: { token: { in: allFailedTokens } },
				data: { isActive: false },
			});
			this.logger.warn(
				`Deactivated ${allFailedTokens.length} invalid FCM tokens during broadcast`,
			);
		}

		this.logger.log(
			`Broadcast sent to ${uniqueDoctors.size} doctors: ${totalSuccess} success, ${totalFailure} failures`,
		);

		return {
			totalDoctors: uniqueDoctors.size,
			successCount: totalSuccess,
			failureCount: totalFailure,
		};
	}
}
