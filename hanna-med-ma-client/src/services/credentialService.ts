import api from '../lib/api';
import type {
    DoctorCredential,
    CreateCredentialDto,
    UpdateCredentialDto,
    EMRSystem
} from '../types';

export const credentialService = {
    /**
     * Get available EMR systems with their required fields
     */
    async getSystems(): Promise<EMRSystem[]> {
        const response = await api.get<EMRSystem[]>('/credentials/systems');
        return response.data;
    },

    /**
     * Get all credentials for a doctor
     */
    async getByDoctor(doctorId: number): Promise<DoctorCredential[]> {
        const response = await api.get<DoctorCredential[]>(`/credentials/doctor/${doctorId}`);
        return response.data;
    },

    /**
     * Get specific credential for a doctor and system
     */
    async getOne(doctorId: number, systemKey: string): Promise<DoctorCredential> {
        const response = await api.get<DoctorCredential>(`/credentials/doctor/${doctorId}/${systemKey}`);
        return response.data;
    },

    /**
     * Create a new credential
     */
    async create(data: CreateCredentialDto): Promise<DoctorCredential> {
        const response = await api.post<DoctorCredential>('/credentials', data);
        return response.data;
    },

    /**
     * Update a credential
     */
    async update(id: number, data: UpdateCredentialDto): Promise<DoctorCredential> {
        const response = await api.patch<DoctorCredential>(`/credentials/${id}`, data);
        return response.data;
    },

    /**
     * Delete a credential
     */
    async delete(id: number): Promise<void> {
        await api.delete(`/credentials/${id}`);
    },
};
