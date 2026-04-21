import api from "../lib/api";

export interface Specialty {
	id: number;
	name: string;
	systemPrompt: string;
	createdAt: string;
	updatedAt: string;
	_count?: { doctors: number };
	doctors?: Array<{ id: number; name: string; username: string }>;
}

export interface CreateSpecialtyDto {
	name: string;
	systemPrompt?: string;
}

export interface UpdateSpecialtyDto {
	name?: string;
	systemPrompt?: string;
}

export const specialtyService = {
	async getAll(): Promise<Specialty[]> {
		const res = await api.get<Specialty[]>("/specialties");
		return res.data;
	},
	async getById(id: number): Promise<Specialty> {
		const res = await api.get<Specialty>(`/specialties/${id}`);
		return res.data;
	},
	async create(data: CreateSpecialtyDto): Promise<Specialty> {
		const res = await api.post<Specialty>("/specialties", data);
		return res.data;
	},
	async update(id: number, data: UpdateSpecialtyDto): Promise<Specialty> {
		const res = await api.patch<Specialty>(`/specialties/${id}`, data);
		return res.data;
	},
	async delete(id: number): Promise<void> {
		await api.delete(`/specialties/${id}`);
	},
};
