FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src/ ./src/

EXPOSE 8083

# node --watch watches /app/src (volume-mounted from host for hot-reload)
CMD ["npm", "run", "dev"]
