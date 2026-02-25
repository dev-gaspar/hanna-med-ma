# Hanna-Med MA V2

Welcome to the Hanna-Med Multi-Agent V2 system. This project consists of three main components:

1. **Client (`hanna-med-ma-client`)**: A React-based web interface for users to interact with the system.
2. **Server (`hanna-med-ma-server`)**: A Node.js backend handling API requests, WebSocket communication, and orchestration logic.
3. **RPA (`hanna-med-ma-rpa`)**: A Python-based Robotic Process Automation service that interacts with Electronic Health Record (EHR) systems.

## Deployment

This repository uses Docker Compose for unified deployment of the `client` and `server` components.

To run the application locally or in a deployment environment (like Dokploy), simply use:

```bash
docker-compose up -d
```

> **Note:** Ensure all required environment variables are configured before deployment.

## RPA Service

The RPA service is built as a standalone Windows executable (`.exe`). Its build and release process is automated via GitHub Actions (`.github/workflows/rpa-release.yml`). See the `hanna-med-ma-rpa` directory for specific development instructions.
