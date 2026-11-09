FROM node:18-bullseye-slim

# התקנת ffmpeg ודפדפן Chromium עבור Puppeteer בוואטסאפ
RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    fonts-noto-core \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
