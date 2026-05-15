FROM node:22-slim

# Install Chrome dependencies, Chrome, FFmpeg, and fonts
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
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
    ffmpeg \
    xvfb \
    xauth \
    && curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
    && dpkg -i /tmp/chrome.deb || apt-get install -f -y \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# Chrome path for HyperFrames
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/index.js"]