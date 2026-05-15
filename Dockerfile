FROM node:22-slim

# Install Chrome dependencies and Chrome
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libatspi2.0-0 \
    libnspr4 \
    fonts-noto-color-emoji \
    fonts-inter \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# HyperFrames will download Chrome on first render
ENV HYPERFRAMES_BROWSER_PATH=/root/.cache/hyperframes/chrome

EXPOSE 3000

CMD ["node", "src/index.js"]