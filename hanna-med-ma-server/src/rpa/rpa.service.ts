import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { RawDataType } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";
import { RegisterRpaDto } from "./dto/register-rpa.dto";
import { CaretrackerResultDto } from "./dto/caretracker-result.dto";
import { CredentialsService } from "../credentials/credentials.service";
import { RedisService } from "../core/redis.service";
import { SubAgentsService } from "../ai/agents/sub-agents.service";
import { FcmService } from "../notifications/fcm.service";
import { nowDate, nowISO, deadlineFromNow, formatForDisplay } from "../core/date.util";

const CARETRACKER_INSURANCE_COMPANIES: Record<string, string> = {
	"0": "SELECT",
	"358321": "AETNA BETTER HEALTH OF FLORIDA",
	"116500": "AETNA U S HEALTHCARE MASTER",
	"242514": "AMERICAN ELDERCARE INS",
	"201793": "AMERICAN PIONEER LIFE INSURANCE",
	"225665": "AMERIGROUP",
	"365770": "AMERIHEALTH CARITAS NEXT FLORIDA",
	"116111": "AVMED",
	"349403": "BAPTIST HEALTH SOUTH FLORIDA",
	"65529": "BLUE SHIELD OF FLORIDA",
	"364910": "BRIGHT HEALTHCARE",
	"267465": "CARE IMPROVEMENTS PLUS",
	"263615": "CAREPLUS HEALTH PLAN INC",
	"340224": "CENTENE CORPORATION",
	"360527": "CENTURION OF FLORIDA LLC",
	"31215": "CHRISTIAN BROTHERS SERVICES",
	"33021": "CIGNA HEALTHCARE",
	"224514": "COVENTRY HEALTH CARE",
	"362985": "DEVOTED HEALTH INC",
	"365312": "DIVISION OF IMMIGRATION HEALTH SERVICES",
	"211095": "DMERC MEDICARE REGIONS",
	"362988": "DOCTORS HEALTHCARE PLANS INC",
	"324673": "FEDERAL CORRECTIONAL INSTITUTE",
	"363139": "FEDERAL DETENTION CENTER",
	"340564": "FLORIDA COMFORT CHOICE",
	"362959": "FLORIDA COMMUNITY CARE",
	"364975": "FLORIDA COMPLETE CARE",
	"211134": "FLORIDA HEALTH PLAN",
	"339904": "FLORIDA PACE CENTER",
	"257364": "FREEDOM HEALTH",
	"20637": "GEHA",
	"365748": "HCA AVENTURA HOSPITAL CHARITY",
	"339769": "HEALTH NETWORK ONE",
	"306422": "HEALTHSUN",
	"29667": "HUMANA",
	"345505": "ICARE HEALTH OPTIONS TPA",
	"340406": "LHANC",
	"202853": "MAGELLAN HEALTH SERVICES",
	"116425": "MAIL HANDLERS INSURANCE",
	"66303": "MEDICAID OF FLORIDA",
	"66561": "MEDICARE OF FLORIDA",
	"116433": "MERITAIN HEALTH",
	"215264": "MOLINA HEALTHCARE",
	"116560": "MONUMENTAL LIFE INS CO",
	"116558": "MUTUAL OF OMAHA",
	"295719": "NAPHCARE INC",
	"362837": "OPUSCARE OF SOUTH FLORIDA",
	"356915": "OSCAR HEALTH",
	"201188": "PODICARE MANAGED CARE POD",
	"260464": "POSITIVE HEALTH CARE",
	"309619": "PRESTIGE HEALTH CHOICE",
	"338288": "PROVIDER NETWORK SOLUTIONS",
	"116156": "RAILROAD MEDICARE",
	"258414": "SELF PAY",
	"358583": "SFETC",
	"362973": "SIMPLY HEALTH",
	"314119": "SUNSHINE STATE HEALTH PLAN",
	"362604": "TRICARE EAST",
	"352412": "TRICARE FOR LIFE",
	"116657": "UNITED AMERICAN INSURANCE CO",
	"96489": "UNITED HEALTHCARE",
	"116098": "UNITED HEALTHCARE AARP",
	"339903": "UNITED HOMECARE",
	"289516": "UNITED MEDICAL RESOURCES INSURANCE",
	"220364": "UNITED TEACHERS ASSOCIATES INSURANCE CO",
	"44889": "USAA",
	"365721": "VALENZ INSURANCE",
	"228769": "WELLCARE",
	"308870": "WELLMED",
	"319920": "WEXFORD HEALTH SOURCES",
};

@Injectable()
export class RpaService {
	private readonly logger = new Logger(RpaService.name);

	constructor(
		private prisma: PrismaService,
		private credentialsService: CredentialsService,
		private subAgentsService: SubAgentsService,
		private fcmService: FcmService,
		private redisService: RedisService,
	) {}

	/**
	 * Register a new RPA node or return existing one.
	 */
	async register(dto: RegisterRpaDto) {
		const existing = await this.prisma.rpaNode.findUnique({
			where: { uuid: dto.uuid },
		});

		if (existing) {
			// Update hostname and lastSeen
			const updated = await this.prisma.rpaNode.update({
				where: { uuid: dto.uuid },
				data: {
					hostname: dto.hostname || existing.hostname,
					lastSeen: nowDate(),
				},
				include: { doctor: { select: { id: true, name: true } } },
			});

			this.logger.log(`RPA node re-registered: ${dto.uuid}`);
			return {
				uuid: updated.uuid,
				status: updated.status,
				doctorId: updated.doctorId,
				doctorName: updated.doctor?.name || null,
			};
		}

		// Create new node
		const node = await this.prisma.rpaNode.create({
			data: {
				uuid: dto.uuid,
				hostname: dto.hostname,
			},
		});

		this.logger.log(`New RPA node registered: ${dto.uuid} (${dto.hostname})`);
		return {
			uuid: node.uuid,
			status: node.status,
			doctorId: null,
			doctorName: null,
		};
	}

	/**
	 * Get configuration for an RPA node (credentials, hospitals, etc.)
	 */
	async getConfig(uuid: string) {
		const node = await this.prisma.rpaNode.findUnique({
			where: { uuid },
			include: {
				doctor: {
					include: {
						credentials: true,
					},
				},
			},
		});

		if (!node) {
			throw new NotFoundException(`RPA node ${uuid} not found`);
		}

		if (!node.doctorId || !node.doctor) {
			return {
				uuid: node.uuid,
				status: node.status,
				doctorId: null,
				credentials: [],
				hospitals: [],
			};
		}

		// Decrypt credentials before sending to RPA
		const decryptedCredentials = await this.credentialsService.findByDoctor(
			node.doctorId,
		);

		// Build hospital list from doctor.emrSystems (source of truth for access)
		// Attach credentials only for systems that have them
		const credsBySystem = new Map<string, Record<string, string>>(
			decryptedCredentials.map((c) => [
				c.systemKey as string,
				c.fields as Record<string, string>,
			]),
		);

		const hospitals = (node.doctor.emrSystems || []).map((system: string) => ({
			type: system,
			credentials: credsBySystem.get(system) || {},
		}));

		return {
			uuid: node.uuid,
			status: node.status,
			doctorId: node.doctorId,
			doctorName: node.doctor.name,
			doctorSpecialty: node.doctor.specialty,
			credentials: decryptedCredentials,
			hospitals,
		};
	}

	/**
	 * Update heartbeat timestamp for an RPA node.
	 */
	async heartbeat(uuid: string) {
		const node = await this.prisma.rpaNode.findUnique({
			where: { uuid },
		});

		if (!node) {
			throw new NotFoundException(`RPA node ${uuid} not found`);
		}

		await this.prisma.rpaNode.update({
			where: { uuid },
			data: {
				lastSeen: nowDate(),
				status: node.doctorId ? "ACTIVE" : node.status,
			},
		});

		return { success: true };
	}

	/**
	 * Assign an RPA node to a doctor (admin action).
	 */
	async assignToDoctor(uuid: string, doctorId: number) {
		const node = await this.prisma.rpaNode.findUnique({
			where: { uuid },
		});

		if (!node) {
			throw new NotFoundException(`RPA node ${uuid} not found`);
		}

		const doctor = await this.prisma.doctor.findFirst({
			where: { id: doctorId, deleted: false },
		});

		if (!doctor) {
			throw new NotFoundException(`Doctor ${doctorId} not found`);
		}

		const updated = await this.prisma.rpaNode.update({
			where: { uuid },
			data: {
				doctorId,
				status: "ACTIVE",
			},
			include: { doctor: { select: { id: true, name: true } } },
		});

		this.logger.log(`RPA node ${uuid} assigned to Doctor ${doctor.name}`);
		return updated;
	}

	/**
	 * List all RPA nodes (admin).
	 */
	async findAll() {
		return this.prisma.rpaNode.findMany({
			include: { doctor: { select: { id: true, name: true } } },
			orderBy: { createdAt: "desc" },
		});
	}

	async dispatchCareTrackerForPatientId(patientId: number) {
		const patient = await this.prisma.patient.findUnique({
			where: { id: patientId },
			include: {
				rawData: {
					where: { dataType: RawDataType.INSURANCE },
					orderBy: { extractedAt: "desc" },
					take: 1,
				},
			},
		});

		if (!patient) {
			throw new NotFoundException(`Patient ${patientId} not found`);
		}

		const latestInsuranceRaw = patient.rawData[0];
		if (!latestInsuranceRaw) {
			throw new NotFoundException(
				`Patient ${patientId} has no INSURANCE raw data available`,
			);
		}

		const aiOutput =
			await this.subAgentsService.formatCareTrackerInsurancePayload(
				latestInsuranceRaw.rawContent,
				{ extractedAt: formatForDisplay(latestInsuranceRaw.extractedAt) },
			);

		const payload = this.normalizeCareTrackerPayload(
			this.parseCareTrackerJson(aiOutput),
		);
		this.logger.log(
			`CareTracker payload for patientId=${patientId}:\n${JSON.stringify(payload, null, 2)}`,
		);

		await this.redisService.pushTask("caretracker:tasks", {
			patientId,
			payload,
		});

		this.logger.log(
			`CareTracker dispatch to Redis completed (patientId=${patientId})`,
		);

		return {
			accepted: true,
			patientId,
			dispatchedAt: nowISO(),
		};
	}

	/**
	 * Marks a patient as seen by creating an Encounter, and triggers async RPA flow
	 * if the patient hasn't been registered in the billing EMR yet.
	 */
	async markPatientAsSeen(patientId: number, doctorId: number, encounterType: "CONSULT" | "PROGRESS" = "CONSULT") {
		const patient = await this.prisma.patient.findUnique({
			where: { id: patientId },
		});

		if (!patient) {
			throw new NotFoundException(`Patient ${patientId} not found`);
		}

		// 1. Create the Encounter
		const encounter = await this.prisma.encounter.create({
			data: {
				patientId,
				doctorId,
				type: encounterType,
				dateOfService: nowDate(),
				deadline: deadlineFromNow(24),
			},
		});

		// 2. If patient not yet registered in billing EMR, trigger RPA
		const needsRegistration = patient.billingEmrStatus === "PENDING" || patient.billingEmrStatus === "FAILED";
		if (needsRegistration) {
			await this.prisma.patient.update({
				where: { id: patientId },
				data: { billingEmrStatus: "PENDING" },
			});

			this.processRpaRegistrationAsync(patient.id, doctorId, patient.name).catch(err => {
				this.logger.error(`Background RPA task failed for ${patientId}: ${err.message}`);
			});
		}

		this.logger.log(`Encounter ${encounter.id} created for patient ${patientId} by doctor ${doctorId}.`);

		return {
			success: true,
			patientId: patient.id,
			encounterId: encounter.id,
			billingEmrStatus: patient.billingEmrStatus,
		};
	}

	/**
	 * Background execution of the CareTracker RPA Registration
	 */
	private async processRpaRegistrationAsync(patientId: number, doctorId: number, patientName: string) {
		this.logger.log(`[Background RPA] Starting for patient ${patientId} (${patientName})`);

		const patient = await this.prisma.patient.findUnique({
			where: { id: patientId },
			include: {
				rawData: {
					where: { dataType: "INSURANCE" },
					orderBy: { extractedAt: "desc" },
					take: 1,
				},
			},
		});

		if (!patient) return;

		if (patient.rawData.length > 0) {
			const latestInsuranceRaw = patient.rawData[0];
			try {
				this.logger.log(`[Background RPA] Formatting payload for ${patientName}...`);
				const aiOutput =
					await this.subAgentsService.formatCareTrackerInsurancePayload(
						latestInsuranceRaw.rawContent,
						{ extractedAt: formatForDisplay(latestInsuranceRaw.extractedAt) },
					);

				const payload = this.normalizeCareTrackerPayload(
					this.parseCareTrackerJson(aiOutput),
				);

				this.logger.log(`[Background RPA] Pushing CareTracker task for ${patientName} to Redis...`);

				await this.redisService.pushTask("caretracker:tasks", {
					patientId,
					doctorId,
					patientName,
					payload,
				});

			} catch (err: any) {
				this.logger.error(`[Background RPA] Payload Prep Failed: ${err.message}`);
				await this.prisma.patient.update({
					where: { id: patientId },
					data: { billingEmrStatus: "FAILED" },
				});

				await this.fcmService.sendPushNotification(
					doctorId,
					"CareTracker Integration",
					`Action required: Failed to prepare data for CareTracker registration for ${patientName}.`
				);
			}
		} else {
			this.logger.warn(`[Background RPA] Patient ${patientId} has no INSURANCE raw data. Generating dummy without RPA.`);
			const emrId = `DUMMY-${patientId}-${nowDate().getTime()}`;

			await this.prisma.patient.update({
				where: { id: patientId },
				data: {
					billingEmrStatus: "REGISTERED",
					billingEmrPatientId: emrId,
				},
			});

			await this.fcmService.sendPushNotification(
				doctorId,
				"CareTracker Integration",
				`Patient ${patientName} has been successfully registered in CareTracker (Dummy ID: ${emrId}).`
			);
		}
	}

	/**
	 * Received from the RPA after asynchronous worker execution via Redis.
	 */
	async handleCareTrackerResult(dto: CaretrackerResultDto) {
		const { patientId, success, status, patient_emr_id, message } = dto;

		this.logger.log(`Received RPA result for patient ${patientId}: success=${success}, status=${status}`);

		const patient = await this.prisma.patient.findUnique({
			where: { id: patientId },
		});

		if (!patient) {
			throw new NotFoundException(`Patient ${patientId} not found`);
		}

		let emrStatus = "FAILED";
		let emrId: string | null = null;

		if (success) {
			emrId = patient_emr_id || null;
			if (status === "NOT_FOUND") {
				emrStatus = emrId ? "REGISTERED" : "FAILED";
			} else if (status === "FOUND_SINGLE" || status === "FOUND_MULTIPLE") {
				emrStatus = "ALREADY_EXISTS";
			} else {
				emrStatus = emrId ? "REGISTERED" : "FAILED";
			}
		}

		await this.prisma.patient.update({
			where: { id: patientId },
			data: {
				billingEmrStatus: emrStatus as any,
				billingEmrPatientId: emrId,
			},
		});

		// Notify all doctors who have encounters with this patient
		const affectedEncounters = await this.prisma.encounter.findMany({
			where: { patientId },
			select: { doctorId: true },
			distinct: ["doctorId"],
		});

		const title = "CareTracker Integration";
		let body = "";
		if (emrStatus === "ALREADY_EXISTS") {
			body = `Patient ${patient.name} was found in CareTracker (ID: ${emrId}). Link established.`;
		} else if (emrStatus === "REGISTERED") {
			body = `Patient ${patient.name}'s data has been prepared in CareTracker.`;
		} else {
			body = `Action required: Failed to process CareTracker registration for ${patient.name}. Reason: ${message || "Unknown error"}`;
		}

		for (const { doctorId } of affectedEncounters) {
			await this.fcmService.sendPushNotification(doctorId, title, body);
		}

		return { processed: true, patientId, emrStatus };
	}

	/**
	 * Returns data availability status for all active patients of the doctor
	 * assigned to the given RPA node. Used for smart extraction filtering.
	 */
	async getPatientDataStatus(
		uuid: string,
		emrSystem: string,
	): Promise<Record<string, { summary: boolean; insurance: boolean; lab: boolean }>> {
		const node = await this.prisma.rpaNode.findUnique({
			where: { uuid },
			select: { doctorId: true },
		});

		if (!node?.doctorId) {
			throw new NotFoundException(`RPA node ${uuid} not found or not assigned`);
		}

		const doctorPatients = await this.prisma.doctorPatient.findMany({
			where: {
				doctorId: node.doctorId,
				isActive: true,
				patient: { emrSystem: emrSystem as any },
			},
			include: {
				patient: {
					include: {
						rawData: {
							select: { dataType: true },
						},
					},
				},
			},
		});

		const result: Record<string, { summary: boolean; insurance: boolean; lab: boolean }> = {};

		for (const dp of doctorPatients) {
			const types = new Set(dp.patient.rawData.map((r) => r.dataType));
			result[dp.patient.name] = {
				summary: types.has("SUMMARY" as any),
				insurance: types.has("INSURANCE" as any),
				lab: types.has("LAB" as any),
			};
		}

		return result;
	}

	/**
	 * Returns the IDs of all patients that have encounters with the given doctor.
	 */
	async getSeenPatientIds(doctorId: number): Promise<number[]> {
		const encounters = await this.prisma.encounter.findMany({
			where: { doctorId },
			select: { patientId: true },
			distinct: ["patientId"],
		});
		return encounters.map((e) => e.patientId);
	}

	/**
	 * Update encounter with provider note info from RPA.
	 */
	async updateEncounterNote(
		encounterId: number,
		data: { noteFile?: string; noteStatus: string; noteRetries?: number },
	) {
		const encounter = await this.prisma.encounter.findUnique({
			where: { id: encounterId },
		});

		if (!encounter) {
			throw new NotFoundException(`Encounter ${encounterId} not found`);
		}

		const updated = await this.prisma.encounter.update({
			where: { id: encounterId },
			data: {
				...(data.noteFile !== undefined && { noteFile: data.noteFile }),
				noteStatus: data.noteStatus as any,
				...(data.noteRetries !== undefined && { noteRetries: data.noteRetries }),
			},
		});

		this.logger.log(
			`Encounter ${encounterId} note updated: status=${data.noteStatus}, file=${data.noteFile || "none"}`,
		);

		return { success: true, encounterId, noteStatus: updated.noteStatus };
	}

	/**
	 * Get encounters that need provider note search.
	 * Returns PENDING encounters with deadline not yet expired.
	 */
	async getPendingNoteEncounters(uuid: string) {
		const node = await this.prisma.rpaNode.findUnique({
			where: { uuid },
			select: { doctorId: true },
		});

		if (!node?.doctorId) {
			throw new NotFoundException(`RPA node ${uuid} not found or not assigned`);
		}

		const encounters = await this.prisma.encounter.findMany({
			where: {
				doctorId: node.doctorId,
				noteStatus: "PENDING",
				deadline: { gt: nowDate() },
			},
			include: {
				patient: {
					select: {
						id: true,
						name: true,
						emrSystem: true,
					},
				},
				doctor: {
					select: {
						id: true,
						name: true,
						specialty: true,
					},
				},
			},
			orderBy: { createdAt: "asc" },
		});

		return encounters.map((e) => ({
			encounterId: e.id,
			patientId: e.patient.id,
			patientName: e.patient.name,
			emrSystem: e.patient.emrSystem,
			doctorId: e.doctor.id,
			doctorName: e.doctor.name,
			doctorSpecialty: e.doctor.specialty,
			encounterType: e.type,
			dateOfService: e.dateOfService,
			deadline: e.deadline,
			noteRetries: e.noteRetries,
		}));
	}

	private parseCareTrackerJson(raw: string): unknown {
		const trimmed = raw.trim();


		try {
			return JSON.parse(trimmed);
		} catch {
			const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
			if (fenced?.[1]) {
				try {
					return JSON.parse(fenced[1]);
				} catch {
					// fall through to final error
				}
			}
		}

		this.logger.error("AI output was not valid JSON for CareTracker payload");
		throw new Error("Invalid JSON returned by AI for CareTracker payload");
	}

	private normalizeCareTrackerPayload(payload: unknown): unknown {
		if (!payload || typeof payload !== "object") {
			throw new Error("CareTracker payload must be an object");
		}

		const body = payload as {
			search_query?: { first_name?: string; last_name?: string };
			insurance_periods?: Array<{
				payer_code?: string;
				ins_company_text?: string;
			}>;
		};

		// Ensure search_query exists with lowercase values
		if (body.search_query) {
			body.search_query.first_name = (body.search_query.first_name || "").toLowerCase().trim();
			body.search_query.last_name = (body.search_query.last_name || "").toLowerCase().trim();
		}

		if (!Array.isArray(body.insurance_periods)) {
			return payload;
		}

		body.insurance_periods = body.insurance_periods.map((period) => {
			const rawCode = String(period?.payer_code || "0").trim();
			if (CARETRACKER_INSURANCE_COMPANIES[rawCode]) {
				return { ...period, payer_code: rawCode };
			}

			const resolvedCode = this.resolveInsuranceCodeByText(
				String(period?.ins_company_text || ""),
			);

			if (resolvedCode !== "0") {
				this.logger.warn(
					`Normalized payer_code from invalid '${rawCode}' to '${resolvedCode}' using ins_company_text='${period?.ins_company_text || ""}'`,
				);
			}

			return {
				...period,
				payer_code: resolvedCode,
			};
		});

		return body;
	}

	private resolveInsuranceCodeByText(insCompanyText: string): string {
		const normalized = this.normalizeToken(insCompanyText);
		if (!normalized) {
			return "0";
		}

		const entries = Object.entries(CARETRACKER_INSURANCE_COMPANIES);
		let bestCode = "0";
		let bestScore = 0;

		for (const [code, label] of entries) {
			if (code === "0") {
				continue;
			}
			const normalizedLabel = this.normalizeToken(label);
			if (!normalizedLabel) {
				continue;
			}

			let score = 0;
			if (normalized === normalizedLabel) {
				score = 100;
			} else if (normalizedLabel.includes(normalized)) {
				score = 80;
			} else if (normalized.includes(normalizedLabel)) {
				score = 70;
			} else {
				const tokens = normalized.split(" ").filter(Boolean);
				const labelTokens = new Set(normalizedLabel.split(" ").filter(Boolean));
				const overlap = tokens.filter((t) => labelTokens.has(t)).length;
				if (overlap > 0) {
					score = overlap * 10;
				}
			}

			if (score > bestScore) {
				bestScore = score;
				bestCode = code;
			}
		}

		if (bestScore >= 20) {
			return bestCode;
		}

		return "0";
	}

	private normalizeToken(value: string): string {
		return (value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	}
}
