FROM node:22-bookworm-slim

# Install FFmpeg, libass, fonts, Python 3 & build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libass-dev fonts-dejavu-core fonts-liberation \
    python3 python3-pip ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python media & AI stack
RUN pip3 install --no-cache-dir --break-system-packages \
    yt-dlp faster-whisper opencv-python-headless

WORKDIR /studio

# Build Frontend
COPY app/web/package*.json ./app/web/
RUN npm --prefix ./app/web install --no-audit --no-fund
COPY app/web ./app/web
RUN npm --prefix ./app/web run build

# Install Backend
COPY app/server/package*.json ./app/server/
RUN npm --prefix ./app/server install --omit=dev --no-audit --no-fund
COPY app/server ./app/server
COPY app/worker ./app/worker

# Runtime writable dirs (works on Hugging Face Spaces port 7860 & Oracle Cloud port 3000)
RUN mkdir -p /studio/app/data /studio/app/storage/uploads /studio/app/storage/projects /studio/app/storage/exports /studio/app/storage/brandkits \
    && chmod -R 777 /studio/app/data /studio/app/storage

ENV PORT=7860
EXPOSE 7860 3000

CMD ["node", "/studio/app/server/index.js"]
