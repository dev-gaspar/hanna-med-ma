import api from "../lib/api";
import type { Doctor, CreateDoctorDto, UpdateDoctorDto } from "../types";

export const doctorService = {
	async getAll(): Promise<Doctor[]> {
		const response = await api.get<Doctor[]>("/doctors");
		return response.data;
	},

	async getById(id: number): Promise<Doctor> {
		const response = await api.get<Doctor>(`/doctors/${id}`);
		return response.data;
	},

	async create(data: CreateDoctorDto): Promise<Doctor> {
		const response = await api.post<Doctor>("/doctors", data);
		return response.data;
	},

	async update(id: number, data: UpdateDoctorDto): Promise<Doctor> {
		const response = await api.patch<Doctor>(`/doctors/${id}`, data);
		return response.data;
	},

	async delete(id: number): Promise<void> {
		await api.delete(`/doctors/${id}`);
	},

	async sendNotification(
		title: string,
		body: string,
		doctorIds?: number[],
	): Promise<{
		success: boolean;
		message: string;
		totalDoctors: number;
		successCount: number;
		failureCount: number;
	}> {
		const response = await api.post("/notifications/send", {
			title,
			body,
			...(doctorIds && doctorIds.length > 0 ? { doctorIds } : {}),
		});
		return response.data;
	},
};
