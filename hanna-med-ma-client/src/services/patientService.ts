import api from "../lib/api";
import type {
	EmrSystem,
	EncounterType,
	Patient,
	PatientBillingInfo,
	PatientDetail,
} from "../types";

/**
 * Doctor-facing patient operations. Hits the `/patients` routes (grouped
 * under the PatientsController on the server).
 */
export const patientService = {
	/** Active patients on the authenticated doctor's census. */
	async getAll(opts?: {
		emrSystem?: EmrSystem;
		active?: boolean;
	}): Promise<Patient[]> {
		const params: Record<string, string> = {};
		if (opts?.emrSystem) params.emrSystem = opts.emrSystem;
		if (opts?.active === false) params.active = "false";
		const response = await api.get<Patient[]>("/patients", { params });
		return response.data;
	},

	/** IDs of patients the doctor has already marked as seen. */
	async getSeenPatientIds(): Promise<number[]> {
		const response = await api.get<number[]>("/patients/seen");
		return response.data;
	},

	/**
	 * Full patient detail — demographics, encounters (with presigned PDF URLs),
	 * and the raw-data timeline (summary, insurance, lab extractions).
	 */
	async getById(patientId: number): Promise<PatientDetail> {
		const response = await api.get<PatientDetail>(`/patients/${patientId}`);
		return response.data;
	},

	/**
	 * Mark a patient as seen by their database ID. Creates an Encounter
	 * and queues billing-EMR registration.
	 *
	 * @param dateOfService Optional YYYY-MM-DD string. Defaults to today.
	 * @param placeOfService Optional CMS POS code ("11", "21", "22", ...).
	 */
	async markAsSeen(
		patientId: number,
		encounterType: EncounterType = "CONSULT",
		dateOfService?: string,
		placeOfService?: string,
	): Promise<PatientBillingInfo> {
		const response = await api.patch<PatientBillingInfo>(
			`/patients/${patientId}/seen`,
			{
				encounterType,
				...(dateOfService ? { dateOfService } : {}),
				...(placeOfService ? { placeOfService } : {}),
			},
		);
		return response.data;
	},
};
