FROM ghcr.io/puppeteer/puppeteer:21.5.0

USER root
RUN rm -f /etc/apt/sources.list.d/google*.list && apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN npm install --production

EXPOSE 3000

CMD ["sh", "-c", "node src/index.js || node index.js"]
