import api from '../lib/api';
import { isJwtExpired } from '../lib/jwt';
import type { LoginCredentials, LoginResponse } from '../types';

export const authService = {
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/login', credentials);
    if (response.data.access_token) {
      localStorage.setItem('token', response.data.access_token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
    }
    return response.data;
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getToken(): string | null {
    return localStorage.getItem('token');
  },

  getCurrentUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  /**
   * Synchronous session check. Returns false if the stored JWT is missing
   * or already expired, AND eagerly clears the stale storage so the
   * protected route can redirect on the very first render — no dashboard
   * flash while we wait for a 401 from the server.
   */
  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;
    if (isJwtExpired(token)) {
      this.logout();
      return false;
    }
    return true;
  },
};
