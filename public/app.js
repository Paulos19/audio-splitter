/* ═══════════════════════════════════════════════════════════════════
   DEMUCS STUDIO — FRONTEND CONTROLLER
   Responsive UI Orchestrator, Live Spectrum Animation & Stem Playback
   ═══════════════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// App State
let selectedFile = null;
let currentJobId = null;
let pollInterval = null;
let timerInterval = null;
let startTime = null;

// DOM Elements
const fileInput = $("#fileInput");
const dropzone = $("#dropzone");
const dropIdleState = $("#dropIdleState");
const dropActiveState = $("#dropActiveState");
const browseBtn = $("#browseBtn");
const fileName = $("#fileName");
const fileSize = $("#fileSize");
const fileExt = $("#fileExt");
const removeFileBtn = $("#removeFileBtn");
const startBtn = $("#startBtn");
const actionStatusText = $("#actionStatusText");

const workspaceContainer = $("#workspaceContainer");
const processingSection = $("#processingSection");
const progressBar = $("#progressBar");
const progressPercent = $("#progressPercent");
const statusMessage = $("#statusMessage");
const timeElapsed = $("#timeElapsed");
const procEngine = $("#procEngine");

const resultsSection = $("#resultsSection");
const stemsContainer = $("#stemsContainer");
const downloadAllBtn = $("#downloadAllBtn");
const newSeparationBtn = $("#newSeparationBtn");

const errorSection = $("#errorSection");
const errorMsg = $("#errorMsg");
const retryBtn = $("#retryBtn");

// Initialize Lucide icons helper
function renderIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

// ── File Handling ──────────────────────────────────────────────
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function handleFileSelect(file) {
  if (!file) return;

  const validExts = ["mp3", "wav", "ogg", "m4a", "flac"];
  const ext = file.name.split(".").pop().toLowerCase();

  if (!validExts.includes(ext)) {
    alert("Formato não suportado. Utilize MP3, WAV, FLAC, M4A ou OGG.");
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    alert("O arquivo excede o limite de 100MB.");
    return;
  }

  selectedFile = file;

  // Update UI Elements
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileExt.textContent = ext.toUpperCase();

  dropIdleState.style.display = "none";
  dropActiveState.style.display = "block";

  startBtn.disabled = false;
  if (actionStatusText) {
    actionStatusText.textContent = "Arquivo pronto. Pronto para isolar as faixas com IA.";
  }

  renderIcons();
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  dropIdleState.style.display = "flex";
  dropActiveState.style.display = "none";
  startBtn.disabled = true;
  if (actionStatusText) {
    actionStatusText.textContent = "Selecione uma faixa para liberar a inferência neural";
  }
}

// Drag & Drop Listeners
if (dropzone) {
  dropzone.addEventListener("click", (e) => {
    if (e.target.closest("#removeFileBtn")) return;
    fileInput.click();
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-active");
  });

  ["dragleave", "dragend"].forEach((evt) => {
    dropzone.addEventListener(evt, () => {
      dropzone.classList.remove("drag-active");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-active");
    if (e.dataTransfer.files.length) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });
}

if (browseBtn) {
  browseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
  });
}

if (fileInput) {
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) {
      handleFileSelect(e.target.files[0]);
    }
  });
}

if (removeFileBtn) {
  removeFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearFile();
  });
}

// ── Model Selection Logic ──────────────────────────────────────
const modelCards = $$(".model-card");
modelCards.forEach((card) => {
  card.addEventListener("click", () => {
    modelCards.forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
  });
});

function getSelectedModel() {
  const checked = document.querySelector('input[name="modelChoice"]:checked');
  return checked ? checked.value : "htdemucs";
}

// ── Timer & Progress Helpers ──────────────────────────────────
function startTimer() {
  startTime = Date.now();
  if (timeElapsed) timeElapsed.textContent = "00:00";
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    if (timeElapsed) timeElapsed.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function setProgress(pct, msg) {
  if (progressBar) progressBar.style.width = `${pct}%`;
  if (progressPercent) progressPercent.textContent = `${pct}%`;
  if (statusMessage) statusMessage.textContent = msg;
}

// ── Job Submission & Polling ──────────────────────────────────
async function startSeparation() {
  if (!selectedFile) return;

  const model = getSelectedModel();

  // Switch UI to Processing mode
  workspaceContainer.style.display = "none";
  errorSection.style.display = "none";
  resultsSection.style.display = "none";
  processingSection.style.display = "block";

  if (procEngine) {
    procEngine.textContent = model.toUpperCase();
  }

  setProgress(5, "Enviando arquivo de áudio para o servidor...");
  startTimer();

  const formData = new FormData();
  formData.append("audio", selectedFile);
  formData.append("model", model);

  try {
    const res = await fetch("/api/separate", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Falha ao enviar arquivo.");
    }

    const data = await res.json();
    currentJobId = data.jobId;

    setProgress(15, "Separando frequências espectrais e isolando faixas...");
    startPolling(currentJobId);
  } catch (err) {
    showError(err.message);
  }
}

function startPolling(jobId) {
  clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/job/${jobId}`);
      if (!res.ok) return;

      const data = await res.json();

      if (data.status === "processing") {
        setProgress(data.progress || 45, data.step || "Processando camadas com Demucs v4...");
      } else if (data.status === "completed") {
        clearInterval(pollInterval);
        stopTimer();
        setProgress(100, "Concluído com fidelidade de estúdio!");
        setTimeout(() => renderResults(data), 600);
      } else if (data.status === "error") {
        clearInterval(pollInterval);
        stopTimer();
        showError(data.error || "Erro no processamento neural.");
      }
    } catch {
      // Ignorar oscilações de rede temporárias
    }
  }, 1500);
}

// ── Stem Presentation & Audio Players ──────────────────────────
const STEM_PRESETS = {
  vocals: { name: "Vocal Principal & Coro", cat: "Acapella Lead", icon: "mic", color: "var(--stem-voc)" },
  instrumental: { name: "Playback Instrumental", cat: "Backing Track", icon: "music", color: "var(--stem-ins)" },
  no_vocals: { name: "Playback Instrumental", cat: "Backing Track", icon: "music", color: "var(--stem-ins)" },
  drums: { name: "Bateria & Percussão", cat: "Rhythm & Beats", icon: "disc", color: "var(--stem-drm)" },
  bass: { name: "Baixo & Sub-Graves", cat: "Low Frequency Engine", icon: "activity", color: "var(--stem-bas)" },
  other: { name: "Harmonia & Sintetizadores", cat: "Melodic Textures", icon: "sliders", color: "var(--stem-oth)" },
  guitar: { name: "Guitarras & Violões", cat: "Acoustic & Electric Strum", icon: "zap", color: "var(--stem-gtr)" },
  piano: { name: "Piano & Teclas", cat: "Acoustic Keys & Chords", icon: "grid", color: "var(--stem-pno)" },
};

function renderResults(data) {
  processingSection.style.display = "none";
  resultsSection.style.display = "block";
  stemsContainer.innerHTML = "";

  if (data.zipUrl) {
    downloadAllBtn.href = data.zipUrl;
    downloadAllBtn.download = `${data.originalName || "demucs"}_stems.zip`;
  }

  const stems = data.stems || {};
  const entries = Object.entries(stems);

  entries.forEach(([key, stemData]) => {
    const preset = STEM_PRESETS[key] || {
      name: key.toUpperCase(),
      cat: "Extracted Stem",
      icon: "volume-2",
      color: "var(--accent-gold)",
    };

    const card = document.createElement("div");
    card.className = "stem-card";
    card.innerHTML = `
      <div class="stem-top-bar">
        <div class="stem-title-wrap">
          <div class="stem-icon-badge" style="background: ${preset.color}22; color: ${preset.color};">
            <i data-lucide="${preset.icon}"></i>
          </div>
          <div class="stem-label-group">
            <span class="stem-name">${preset.name}</span>
            <span class="stem-category">${preset.cat}</span>
          </div>
        </div>
        <a href="${stemData.url}" download="${stemData.filename}" class="btn-stem-download" title="Baixar WAV Master">
          <i data-lucide="download"></i>
        </a>
      </div>

      <div class="stem-player">
        <audio controls src="${stemData.url}" preload="metadata"></audio>
      </div>
    `;

    stemsContainer.appendChild(card);
  });

  renderIcons();
}

function showError(msg) {
  stopTimer();
  clearInterval(pollInterval);
  processingSection.style.display = "none";
  errorSection.style.display = "block";
  if (errorMsg) errorMsg.textContent = msg;
  renderIcons();
}

function resetToHome() {
  stopTimer();
  clearInterval(pollInterval);
  currentJobId = null;
  clearFile();
  workspaceContainer.style.display = "block";
  processingSection.style.display = "none";
  resultsSection.style.display = "none";
  errorSection.style.display = "none";
  renderIcons();
}

// ── Event Handlers ─────────────────────────────────────────────
if (startBtn) startBtn.addEventListener("click", startSeparation);
if (retryBtn) retryBtn.addEventListener("click", resetToHome);
if (newSeparationBtn) newSeparationBtn.addEventListener("click", resetToHome);

// Initial call
document.addEventListener("DOMContentLoaded", () => {
  renderIcons();
});
renderIcons();
