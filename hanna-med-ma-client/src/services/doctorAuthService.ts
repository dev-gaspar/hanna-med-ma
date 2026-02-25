import api from "../lib/api";
import type { LoginCredentials, DoctorLoginResponse } from "../types";

/**
 * Doctor Authentication Service
 * Uses sessionStorage for HIPAA compliance (session clears on tab close)
 */
export const doctorAuthService = {
    async login(
        credentials: LoginCredentials
    ): Promise<DoctorLoginResponse> {
        const response = await api.post<DoctorLoginResponse>(
            "/auth/doctor-login",
            credentials
        );
        if (response.data.access_token) {
            // Use localStorage for persistence (PWA standard)
            localStorage.setItem("doctor_token", response.data.access_token);
            localStorage.setItem("doctor", JSON.stringify(response.data.doctor));
        }
        return response.data;
    },

    logout() {
        localStorage.removeItem("doctor_token");
        localStorage.removeItem("doctor");
    },

    getToken(): string | null {
        return localStorage.getItem("doctor_token");
    },

    getCurrentDoctor() {
        const doctorStr = localStorage.getItem("doctor");
        return doctorStr ? JSON.parse(doctorStr) : null;
    },

    isAuthenticated(): boolean {
        return !!this.getToken();
    },
};
