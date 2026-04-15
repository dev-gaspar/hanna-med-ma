import api from "../lib/api";
import type { PatientBillingInfo, EncounterType } from "../types";

export const patientService = {
	/**
	 * Mark a patient as seen by their database ID, creating an Encounter.
	 *
	 * @param dateOfService Optional YYYY-MM-DD string. If omitted, the server
	 * uses today's date. Useful when catching up on a visit the doctor forgot
	 * to mark the day of.
	 */
	async markAsSeen(
		patientId: number,
		encounterType: EncounterType = "CONSULT",
		dateOfService?: string,
	): Promise<PatientBillingInfo> {
		const response = await api.patch<PatientBillingInfo>(
			`/rpa/patients/${patientId}/seen`,
			{ encounterType, ...(dateOfService ? { dateOfService } : {}) },
		);
		return response.data;
	},

	/**
	 * Get the list of IDs for all patients already marked as seen.
	 */
	async getSeenPatientIds(): Promise<number[]> {
		const response = await api.get<number[]>("/rpa/patients/seen");
		return response.data;
	},
};
