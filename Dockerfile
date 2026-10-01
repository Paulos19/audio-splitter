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
    python3-dev \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment and install Demucs + dependencies
# Step 1: Create venv and upgrade pip
RUN python3 -m venv /opt/demucs-env \
    && /opt/demucs-env/bin/pip install --no-cache-dir --upgrade pip setuptools wheel

# Step 2: Install PyTorch CPU first (isolated to avoid numpy conflicts)
RUN /opt/demucs-env/bin/pip install --no-cache-dir \
    torch==2.1.2+cpu --extra-index-url https://download.pytorch.org/whl/cpu

# Step 3: Install numpy (pinned <2 for compatibility with torch 2.1.x and demucs)
RUN /opt/demucs-env/bin/pip install --no-cache-dir "numpy<2"

# Step 4: Install demucs (will use the already-installed torch and numpy)
RUN /opt/demucs-env/bin/pip install --no-cache-dir demucs

# Verify numpy is importable (fail build early if broken)
RUN /opt/demucs-env/bin/python -c "import numpy; print(f'numpy {numpy.__version__} OK')"

# Make demucs venv available in PATH
ENV PATH="/opt/demucs-env/bin:$PATH"
ENV VIRTUAL_ENV="/opt/demucs-env"

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

# Health check (generous start period for PyTorch model download)
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the server
CMD ["node", "server.js"]
