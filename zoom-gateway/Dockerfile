# Pin to linux/amd64 so Puppeteer's bundled x86-64 Chromium runs correctly
# (required when building/running on Apple Silicon via Rosetta 2)
FROM --platform=linux/amd64 node:22-slim

# System libraries required by Puppeteer's bundled Chromium
# (full set including ALSA audio, fonts, and all Chrome render-pipeline deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps (puppeteer downloads Chromium here — baked into the image)
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 3001

# ts-node-dev watches /app/src (volume-mounted from host for hot-reload)
CMD ["npm", "run", "dev"]
