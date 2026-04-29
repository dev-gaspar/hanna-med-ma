import api from "../lib/api";

export interface PlaceOfServiceCode {
	code: string;
	name: string;
	shortLabel: string;
	description: string;
	active: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface CreatePlaceOfServiceCodeInput {
	code: string;
	name: string;
	shortLabel: string;
	description: string;
	active?: boolean;
}

export type UpdatePlaceOfServiceCodeInput = Partial<
	Omit<CreatePlaceOfServiceCodeInput, "code">
>;

/**
 * CMS Place-of-Service catalog. Read endpoints used by the doctor
 * portal's "Mark as seen" modal; write endpoints used by the admin
 * configuration UI.
 */
export const placeOfServiceService = {
	async getAll(opts?: {
		includeInactive?: boolean;
	}): Promise<PlaceOfServiceCode[]> {
		const response = await api.get<PlaceOfServiceCode[]>(
			"/place-of-service-codes",
			{
				params: opts?.includeInactive ? { includeInactive: "true" } : undefined,
			},
		);
		return response.data;
	},

	async getOne(code: string): Promise<PlaceOfServiceCode> {
		const response = await api.get<PlaceOfServiceCode>(
			`/place-of-service-codes/${code}`,
		);
		return response.data;
	},

	async create(
		input: CreatePlaceOfServiceCodeInput,
	): Promise<PlaceOfServiceCode> {
		const response = await api.post<PlaceOfServiceCode>(
			"/place-of-service-codes",
			input,
		);
		return response.data;
	},

	async update(
		code: string,
		input: UpdatePlaceOfServiceCodeInput,
	): Promise<PlaceOfServiceCode> {
		const response = await api.patch<PlaceOfServiceCode>(
			`/place-of-service-codes/${code}`,
			input,
		);
		return response.data;
	},

	async deactivate(code: string): Promise<PlaceOfServiceCode> {
		const response = await api.delete<PlaceOfServiceCode>(
			`/place-of-service-codes/${code}`,
		);
		return response.data;
	},
};
