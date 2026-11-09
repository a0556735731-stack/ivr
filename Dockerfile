FROM ghcr.io/puppeteer/puppeteer:21.5.0

USER root
RUN apt-get update && apt-get install -y ffmpeg unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN npm install --production

EXPOSE 3000

CMD ["sh", "-c", "node src/index.js || node index.js"]
