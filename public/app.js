/* ═══════════════════════════════════════════════════════════════════
   AUDIO SPLITTER — Frontend Controller Logic
   Refined Lucide icons support, dynamic timer, stem mixers & animations
   ═══════════════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── DOM References ──
const uploadZone = $("#uploadZone");
const fileInput = $("#fileInput");
const uploadContent = $("#uploadContent");
const fileDetails = $("#fileDetails");
const fileName = $("#fileName");
const fileSize = $("#fileSize");
const removeFileBtn = $("#removeFileBtn");
const processBtn = $("#processBtn");

const processingSection = $("#processingSection");
const progressMsg = $("#progressMsg");
const progressBar = $("#progressBar");
const elapsedTimer = $("#elapsedTimer");

const resultsSection = $("#resultsSection");
const stemsContainer = $("#stemsContainer");
const downloadAllBtn = $("#downloadAllBtn");
const newSeparationBtn = $("#newSeparationBtn");

const errorSection = $("#errorSection");
const errorMsg = $("#errorMsg");
const retryBtn = $("#retryBtn");

// ── State ──
let selectedFile = null;
let selectedModel = "htdemucs";
let selectedStems = "vocals";
let currentJobId = null;
let pollInterval = null;
let timerInterval = null;
let startTime = null;

// ── Lucide Icon Refresh Helper ──
function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

// ── Model Selection Handler ──
$$("#modelCards .opt-btn").forEach((card) => {
  card.addEventListener("click", () => {
    $$("#modelCards .opt-btn").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    selectedModel = card.dataset.model;
  });
});

// ── Stems Selection Handler ──
$$("#stemsCards .opt-btn").forEach((card) => {
  card.addEventListener("click", () => {
    $$("#stemsCards .opt-btn").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    selectedStems = card.dataset.stems;
  });
});

// ── Drag & Drop Events ──
uploadZone.addEventListener("click", (e) => {
  if (e.target.closest("#removeFileBtn")) return;
  fileInput.click();
});

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
  }
});

// ── File Ingestion ──
function handleFile(file) {
  const allowed = [".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma"];
  const ext = "." + file.name.split(".").pop().toLowerCase();
  
  if (!allowed.includes(ext)) {
    showError("Formato não suportado. Por favor, envie arquivos de áudio válidos: MP3, WAV, FLAC, OGG, M4A ou AAC.");
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    showError("Arquivo muito grande. O limite máximo para separação na nuvem é de 100MB.");
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = (file.size / (1024 * 1024)).toFixed(1) + " MB";

  uploadContent.style.display = "none";
  fileDetails.style.display = "flex";
  processBtn.disabled = false;
  hideError();
  refreshIcons();
}

removeFileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  resetFile();
});

function resetFile() {
  selectedFile = null;
  fileInput.value = "";
  uploadContent.style.display = "flex";
  fileDetails.style.display = "none";
  processBtn.disabled = true;
  refreshIcons();
}

// ── Timer Logic ──
function startTimer() {
  startTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const secs = String(elapsedSeconds % 60).padStart(2, "0");
    elapsedTimer.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ── Submit Processing Job ──
processBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  hideAll();
  processingSection.style.display = "block";
  progressMsg.textContent = "Fazendo upload seguro e enfileirando no pipeline Demucs...";
  progressBar.style.width = "15%";
  startTimer();
  refreshIcons();

  const formData = new FormData();
  formData.append("audio", selectedFile);
  formData.append("model", selectedModel);
  formData.append("stems", selectedStems);

  try {
    const res = await fetch("/api/split", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Erro ao iniciar o processamento");
    }

    currentJobId = data.jobId;
    pollStatus(currentJobId);
  } catch (err) {
    stopTimer();
    showError(err.message);
  }
});

// ── Job Polling ──
function pollStatus(jobId) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const job = await res.json();

      if (job.message) {
        progressMsg.textContent = job.message;
      }

      if (job.progress) {
        progressBar.style.width = `${job.progress}%`;
      }

      if (job.status === "completed") {
        clearInterval(pollInterval);
        stopTimer();
        progressBar.style.width = "100%";
        progressMsg.textContent = "Mixdown finalizado com sucesso!";
        setTimeout(() => showResults(job), 600);
      }

      if (job.status === "error") {
        clearInterval(pollInterval);
        stopTimer();
        showError(job.error || "Falha durante o processamento acústico neural.");
      }
    } catch {
      // Network hiccup, keep retrying
    }
  }, 1500);
}

// ── Render Results Deck ──
const STEM_PRESETS = {
  vocals: { name: "Vocal Principal & Coro", cat: "Acapella Lead", icon: "mic", cls: "stem-vocals" },
  instrumental: { name: "Playback Instrumental", cat: "Backing Track", icon: "music", cls: "stem-instrumental" },
  no_vocals: { name: "Playback Instrumental", cat: "Backing Track", icon: "music", cls: "stem-instrumental" },
  drums: { name: "Bateria & Percussão", cat: "Rhythm & Transient", icon: "disc", cls: "stem-drums" },
  bass: { name: "Baixo & Sub-Frequências", cat: "Low-End Spectrum", icon: "activity", cls: "stem-bass" },
  other: { name: "Sintetizadores & Guitarras", cat: "Harmonics & FX", icon: "sliders", cls: "stem-other" }
};

function showResults(job) {
  hideAll();
  resultsSection.style.display = "flex";
  stemsContainer.innerHTML = "";

  const stems = job.stems || {};
  const entries = Object.entries(stems);

  entries.forEach(([key, info]) => {
    const meta = STEM_PRESETS[key] || {
      name: key.toUpperCase(),
      cat: "Audio Track",
      icon: "volume-2",
      cls: "stem-other"
    };

    const card = document.createElement("div");
    card.className = `stem-channel-card ${meta.cls}`;
    card.innerHTML = `
      <div class="stem-meta">
        <div class="stem-badge-tag">
          <i data-lucide="${meta.icon}"></i>
        </div>
        <div class="stem-title-wrap">
          <span class="stem-name">${meta.name}</span>
          <span class="stem-category">${meta.cat}</span>
        </div>
      </div>

      <div class="stem-player-controls">
        <audio controls preload="metadata" src="${info.url}"></audio>
      </div>

      <a href="${info.url}" download="${info.filename}" class="stem-download-btn">
        <i data-lucide="download"></i>
        <span>WAV</span>
      </a>
    `;

    stemsContainer.appendChild(card);
  });

  if (entries.length > 0) {
    downloadAllBtn.href = `/api/download-all/${job.id}`;
    downloadAllBtn.style.display = "inline-flex";
  } else {
    downloadAllBtn.style.display = "none";
  }

  refreshIcons();
}

// ── Reset & Retry Actions ──
newSeparationBtn.addEventListener("click", () => {
  hideAll();
  resetFile();
});

retryBtn.addEventListener("click", () => {
  hideAll();
  resetFile();
});

// ── Screen Transitions ──
function hideAll() {
  processingSection.style.display = "none";
  resultsSection.style.display = "none";
  errorSection.style.display = "none";
}

function showError(msg) {
  hideAll();
  errorSection.style.display = "block";
  errorMsg.textContent = msg;
  refreshIcons();
}

function hideError() {
  errorSection.style.display = "none";
}

// Initial icon hydration
document.addEventListener("DOMContentLoaded", () => {
  refreshIcons();
});
