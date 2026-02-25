# Hanna Med Client - React + Vite

Cliente web para el sistema Hanna Med.

## 🚀 Inicio Rápido

### Local con Docker Compose:

```bash
# 1. Crear archivo .env
VITE_API_URL=http://localhost:3001

# 2. Iniciar
docker-compose up -d

# 3. Acceder
# http://localhost
```

### Dokploy:

1. En **Environment Variables** configura:
```
VITE_API_URL=https://api.tu-dominio.com
```

2. En **Domains** configura:
   - Container Port: `3002`
   - Asigna tu dominio

3. Deploy

## 🛠️ Stack

- React 19
- Vite
- TypeScript
- Tailwind CSS
- Axios
- React Router DOM

## 📝 Variables de Entorno

- `VITE_API_URL`: URL del API backend (se configura en build time)

**Importante:** Las variables `VITE_*` se reemplazan durante el build, no en runtime.

## 🏗️ Build Local

```bash
# Instalar dependencias
npm install

# Desarrollo
npm run dev

# Build
npm run build

# Preview
npm run preview
```

## 📦 Estructura

```
src/
├── components/     # Componentes reutilizables
├── pages/          # Páginas de la app
├── services/       # Servicios de API
├── lib/            # Configuración (axios)
└── types/          # Tipos TypeScript
```

