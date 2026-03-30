import api from "../lib/api";
import type { PatientBillingInfo } from "../types";

export const patientService = {
	/**
	 * Mark a patient as seen by their display name.
	 * The server resolves the name to a DB ID internally (direct prisma lookup).
	 */
	async markAsSeenByName(patientName: string): Promise<PatientBillingInfo> {
		const response = await api.patch<PatientBillingInfo>(
			"/rpa/patients/seen-by-name",
			{ patientName },
		);
		return response.data;
	},
};
