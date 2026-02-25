# Hanna Med API - Docker

API REST para gestión de asistentes médicos con NestJS.

## Inicio Rápido

```bash
# 1. Configurar variables de entorno
cp .env.template .env
# Edita .env con tus valores

# 2. Iniciar
docker-compose up -d

# 3. Ver logs
docker-compose logs -f

# 4. Acceder a la API
# http://localhost:3000/docs
```

## Variables de Entorno Necesarias

Crea un archivo `.env` con:

```env
SERVER_NODE_ENV=production
SERVER_PORT=3001
SERVER_DATABASE_URL=postgresql://usuario:password@host:puerto/database?schema=public
SERVER_JWT_SECRET=tu_secreto_jwt_seguro
SERVER_RPA_DOMAIN=tu-dominio.com
```

**Importante:**

- `SERVER_DATABASE_URL`: Conexión a tu PostgreSQL externo
- `SERVER_JWT_SECRET`: Genera uno con: `openssl rand -hex 32`
- Todas las variables usan prefijo `SERVER_` para evitar conflictos con Dokploy

## Comandos

```bash
# Iniciar
docker-compose up -d

# Detener
docker-compose down

# Ver logs
docker-compose logs -f

# Reconstruir
docker-compose build --no-cache

# Reiniciar
docker-compose restart
```

## Cloudflare Tunnels (Opcional)

Si usas túneles RPA:

```bash
# Instalar cloudflared
winget install Cloudflare.cloudflared  # Windows
brew install cloudflared              # Mac

# Autenticar
cloudflared tunnel login

# Copiar credenciales al contenedor
docker cp ~/.cloudflared/cert.pem hanna-med-api:/root/.cloudflared/
```

## Stack

- NestJS + TypeScript
- Prisma ORM
- PostgreSQL (externo)
- Cloudflare Tunnels
- JWT Auth
- Swagger/OpenAPI

## Endpoints

- **Docs**: http://localhost:3001/docs
- **Auth**: `/auth/login`, `/auth/doctor/login`
- **Users**: `/users`
- **Doctors**: `/doctors`
- **Tunnels**: `/tunnels`
