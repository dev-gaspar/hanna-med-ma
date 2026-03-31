import api from "../lib/api";
import type { PatientBillingInfo, EncounterType } from "../types";

export const patientService = {
	/**
	 * Mark a patient as seen by their database ID, creating an Encounter.
	 */
	async markAsSeen(patientId: number, encounterType: EncounterType = "CONSULT"): Promise<PatientBillingInfo> {
		const response = await api.patch<PatientBillingInfo>(
			`/rpa/patients/${patientId}/seen`,
			{ encounterType },
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
