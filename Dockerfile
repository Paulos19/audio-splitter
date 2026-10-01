# ═══════════════════════════════════════════
#  AUDIO SPLITTER — Dockerfile
#  Node.js + Python + Demucs (CPU)
# ═══════════════════════════════════════════

FROM node:20-slim AS base

# Install Python, pip, ffmpeg and build essentials
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment and install Demucs
RUN python3 -m venv /opt/demucs-env \
    && /opt/demucs-env/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/demucs-env/bin/pip install --no-cache-dir demucs

# Make demucs available in PATH
ENV PATH="/opt/demucs-env/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy package files and install Node dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create required directories
RUN mkdir -p uploads output

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the server
CMD ["node", "server.js"]
