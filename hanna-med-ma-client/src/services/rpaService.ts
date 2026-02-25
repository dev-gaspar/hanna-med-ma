import api from '../lib/api';
import type { RpaNode } from '../types';

export const rpaService = {
    async getAll(): Promise<RpaNode[]> {
        const response = await api.get<RpaNode[]>('/rpa');
        return response.data;
    },

    async assignToDoctor(uuid: string, doctorId: number): Promise<RpaNode> {
        const response = await api.post<RpaNode>(`/rpa/${uuid}/assign/${doctorId}`);
        return response.data;
    },
};
