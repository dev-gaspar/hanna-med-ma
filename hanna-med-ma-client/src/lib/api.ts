import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add token to requests (context-aware: uses doctor or admin token based on current path)
api.interceptors.request.use((config) => {
  const currentPath = window.location.pathname;
  let token: string | null = null;

  if (currentPath.startsWith("/doctor")) {
    token = localStorage.getItem("doctor_token");
  } else if (currentPath.startsWith("/admin")) {
    token = localStorage.getItem("token");
  } else {
    // Fallback: try admin first, then doctor
    token = localStorage.getItem("token") || localStorage.getItem("doctor_token");
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses - redirect based on current path
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const currentPath = window.location.pathname;

      // Determine which portal we're in
      if (currentPath.startsWith("/doctor")) {
        localStorage.removeItem("doctor_token");
        localStorage.removeItem("doctor");
        window.location.href = "/doctor/login";
      } else if (currentPath.startsWith("/admin")) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/admin/login";
      } else {
        // Unknown path, redirect to landing
        window.location.href = "/";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
