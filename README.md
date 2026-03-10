# Hanna-Med MA

**HannaMed MA** is a medical assistant system that automates clinical data extraction from EMR (Electronic Medical Records) systems using RPA and artificial intelligence. It allows doctors to view patient records, receive real-time notifications, and manage automation nodes — all from a centralized web interface.

This project consists of three main components:

1. **Client (`hanna-med-ma-client`)**: Web interface built with React, Vite, and TailwindCSS. Serves as the dashboard for doctors and administrators to view patient records, manage reports, receive push notifications (Firebase), and monitor RPA node status in real time via WebSocket.

2. **Server (`hanna-med-ma-server`)**: Backend built with NestJS, Prisma, and PostgreSQL. Handles authentication (JWT), business logic, real-time communication (WebSocket/Socket.IO), RPA node orchestration, AI-powered data processing (LangChain + Gemini), and push notifications. Exposes the REST API consumed by both the client and RPA nodes.

3. **RPA (`hanna-med-ma-rpa`)**: Robotic Process Automation service written in Python. Runs as a headless process on Windows that registers with the backend, receives doctor assignments, and automatically extracts patient data from EMR systems via GUI automation (PyAutoGUI, image recognition). Extracted data is sent to the server for AI processing.

## Deployment

This repository uses Docker Compose for unified deployment of the `client` and `server` components.

To run the application locally or in a deployment environment (like Dokploy), simply use:

```bash
docker-compose up -d
```

> **Note:** Ensure all required environment variables are configured before deployment.

## RPA Service

The RPA service is built as a standalone Windows executable (`.exe`). Its build and release process is automated via GitHub Actions (`.github/workflows/rpa-release.yml`). See the `hanna-med-ma-rpa` directory for specific development instructions.
