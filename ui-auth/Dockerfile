FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

# next dev watches /app/src (volume-mounted from host for hot-reload)
CMD ["npm", "run", "dev"]
