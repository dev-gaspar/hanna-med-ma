import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Service implements OnModuleInit {
	private readonly logger = new Logger(S3Service.name);
	private client: S3Client;
	private bucket: string;
	private presignedTtl: number;

	constructor(private configService: ConfigService) {}

	onModuleInit() {
		const region = this.configService.get<string>("SERVER_AWS_REGION", "us-east-2");
		const accessKeyId = this.configService.get<string>("SERVER_AWS_ACCESS_KEY_ID");
		const secretAccessKey = this.configService.get<string>("SERVER_AWS_SECRET_ACCESS_KEY");
		this.bucket = this.configService.get<string>("SERVER_AWS_S3_BUCKET", "hannamed-ma");
		this.presignedTtl = this.configService.get<number>("SERVER_AWS_PRESIGNED_TTL", 3600);

		if (!accessKeyId || !secretAccessKey) {
			this.logger.warn("AWS credentials not configured — S3 operations will fail");
			return;
		}

		this.client = new S3Client({
			region,
			credentials: { accessKeyId, secretAccessKey },
		});

		this.logger.log(`S3 initialized — bucket: ${this.bucket}, region: ${region}`);
	}

	/**
	 * Upload a file to S3.
	 * @param key - Full S3 key (e.g. "errors/doctor-1/screenshot.png")
	 * @param body - File content as Buffer or string
	 * @param contentType - MIME type
	 * @returns The S3 key of the uploaded file
	 */
	async upload(key: string, body: Buffer | string, contentType: string): Promise<string> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: body,
				ContentType: contentType,
			}),
		);
		this.logger.debug(`Uploaded: s3://${this.bucket}/${key}`);
		return key;
	}

	/**
	 * Generate a presigned URL to access a file.
	 * @param key - S3 key
	 * @param ttl - Expiration in seconds (defaults to config value)
	 */
	async getPresignedUrl(key: string, ttl?: number): Promise<string> {
		const command = new GetObjectCommand({
			Bucket: this.bucket,
			Key: key,
		});
		return getSignedUrl(this.client, command, {
			expiresIn: ttl ?? this.presignedTtl,
		});
	}

	/**
	 * Delete a file from S3.
	 */
	async delete(key: string): Promise<void> {
		await this.client.send(
			new DeleteObjectCommand({
				Bucket: this.bucket,
				Key: key,
			}),
		);
		this.logger.debug(`Deleted: s3://${this.bucket}/${key}`);
	}

	/**
	 * List objects under a prefix.
	 * @param prefix - S3 key prefix (e.g. "documents/doctor-1/")
	 * @param maxKeys - Maximum number of keys to return
	 */
	async list(prefix: string, maxKeys = 100): Promise<string[]> {
		const result = await this.client.send(
			new ListObjectsV2Command({
				Bucket: this.bucket,
				Prefix: prefix,
				MaxKeys: maxKeys,
			}),
		);
		return (result.Contents ?? []).map((obj) => obj.Key).filter(Boolean) as string[];
	}

	/**
	 * Get the configured bucket name.
	 */
	getBucket(): string {
		return this.bucket;
	}
}
