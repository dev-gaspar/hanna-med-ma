import {
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	ParseIntPipe,
	Patch,
	Query,
	Request,
	UseGuards,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiBody,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { IngestService } from "../ingest/ingest.service";
import { RpaService } from "../rpa/rpa.service";
import { PrismaService } from "../core/prisma.service";
import { S3Service } from "../core/s3.service";

/**
 * Doctor-facing patient endpoints.
 *
 * These used to live under /rpa/* alongside the RPA ingestion routes, which
 * was confusing: the RPA worker only needs ingest/heartbeat/config, while the
 * doctor portal only needs list/seen/mark-seen. This controller groups the
 * consumer-side routes under /patients and delegates to the existing services.
 *
 * The legacy /rpa/patients* routes are kept for back-compat; new clients
 * should hit /patients*.
 */
@ApiTags("Patients")
@Controller("patients")
export class PatientsController {
	constructor(
		private readonly ingestService: IngestService,
		private readonly rpaService: RpaService,
		private readonly prisma: PrismaService,
		private readonly s3: S3Service,
	) {}

	@Get()
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "List patients on the authenticated doctor's census" })
	@ApiQuery({ name: "emrSystem", required: false })
	@ApiQuery({ name: "active", required: false })
	async list(
		@Request() req,
		@Query("emrSystem") emrSystem?: string,
		@Query("active") active?: string,
	) {
		const doctorId = req.user.userId;
		return this.ingestService.getPatients(
			doctorId,
			emrSystem,
			active !== "false",
		);
	}

	@Get("seen")
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({ summary: "Get IDs of patients the current doctor has marked as seen" })
	@ApiResponse({ status: 200, description: "Array of patient IDs", type: [Number] })
	async seen(@Request() req) {
		const doctorId = req.user.userId;
		return this.rpaService.getSeenPatientIds(doctorId);
	}

	@Get(":id")
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({
		summary: "Get full patient detail — encounters, raw-data timeline, presigned PDF URLs",
	})
	@ApiParam({ name: "id", type: "number" })
	async detail(
		@Param("id", ParseIntPipe) patientId: number,
		@Request() req,
	) {
		const doctorId = req.user.userId;

		// Ensure the doctor is actually linked to this patient before handing
		// anything back — the raw PHI must never leak across censuses.
		const link = await this.prisma.doctorPatient.findUnique({
			where: { doctorId_patientId: { doctorId, patientId } },
		});
		if (!link) {
			throw new NotFoundException("Patient not found on your census");
		}

		const patient = await this.prisma.patient.findUnique({
			where: { id: patientId },
			include: {
				encounters: {
					where: { doctorId },
					orderBy: { dateOfService: "desc" },
					take: 20,
				},
				rawData: {
					orderBy: { extractedAt: "desc" },
					select: {
						id: true,
						dataType: true,
						extractedAt: true,
						file: true,
						createdAt: true,
					},
				},
			},
		});
		if (!patient) throw new NotFoundException("Patient not found");

		// Sign S3 keys so the client can render the PDFs directly without
		// round-tripping through our server. TTL defaults to 1h (config).
		const encounters = await Promise.all(
			patient.encounters.map(async (e) => ({
				...e,
				faceSheetUrl: e.faceSheet
					? await this.s3.getPresignedUrl(e.faceSheet)
					: null,
				providerNoteUrl: e.providerNote
					? await this.s3.getPresignedUrl(e.providerNote)
					: null,
			})),
		);

		return { ...patient, encounters };
	}

	@Patch(":patientId/seen")
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth("JWT-auth")
	@ApiOperation({
		summary:
			"Mark a patient as seen — creates an Encounter and queues billing EMR registration",
	})
	@ApiParam({ name: "patientId", type: "number" })
	@ApiBody({
		schema: {
			type: "object",
			properties: {
				encounterType: {
					type: "string",
					enum: ["CONSULT", "PROGRESS"],
					default: "CONSULT",
				},
				dateOfService: {
					type: "string",
					format: "date",
					description:
						"Optional ISO date (YYYY-MM-DD). Defaults to today when omitted.",
				},
			},
		},
		required: false,
	})
	async markAsSeen(
		@Param("patientId", ParseIntPipe) patientId: number,
		@Body()
		body: {
			encounterType?: "CONSULT" | "PROGRESS";
			dateOfService?: string;
		},
		@Request() req,
	) {
		const doctorId = req.user.userId;
		const encounterType = body?.encounterType || "CONSULT";
		const dateOfService = body?.dateOfService
			? new Date(body.dateOfService)
			: undefined;
		return this.rpaService.markPatientAsSeen(
			patientId,
			doctorId,
			encounterType,
			dateOfService,
		);
	}
}
