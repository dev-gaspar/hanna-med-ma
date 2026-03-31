FROM node:20-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm install

# Copiar código fuente
COPY . .

# Generar Prisma Client y compilar
# SERVER_DATABASE_URL is only needed at runtime; use a dummy for generate
RUN SERVER_DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    npm run prisma:generate && npm run build

# Exponer puerto
EXPOSE 3001

# Comando de inicio
CMD ["node", "dist/src/main.js"]
