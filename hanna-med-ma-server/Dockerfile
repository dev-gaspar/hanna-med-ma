FROM node:20-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm ci

# Copiar código fuente
COPY . .

# Generar Prisma Client y compilar
RUN npm run prisma:generate && npm run build

# Exponer puerto
EXPOSE 3001

# Comando de inicio
CMD ["node", "dist/src/main.js"]
