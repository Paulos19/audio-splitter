/* ═══════════════════════════════════════════
   AUDIO SPLITTER — Frontend Logic
   ═══════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Elements ──
const uploadZone = $("#uploadZone");
const fileInput = $("#fileInput");
const uploadContent = $("#uploadContent");
const fileInfo = $("#fileInfo");
const fileName = $("#fileName");
const fileSize = $("#fileSize");
const fileRemove = $("#fileRemove");
const btnSplit = $("#btnSplit");
const modelCards = $("#modelCards");
const stemsCards = $("#stemsCards");
const processingSection = $("#processingSection");
const processingFile = $("#processingFile");
const progressFill = $("#progressFill");
const progressText = $("#progressText");
const resultsSection = $("#resultsSection");
const resultsTime = $("#resultsTime");
const stemsGrid = $("#stemsGrid");
const errorSection = $("#errorSection");
const errorMessage = $("#errorMessage");
const btnRetry = $("#btnRetry");

// ── State ──
let selectedFile = null;
let selectedModel = "htdemucs";
let selectedStems = "vocals";
let currentAudio = null;
let currentPlayBtn = null;

// ── Model Selection ──
modelCards.addEventListener("click", (e) => {
  const card = e.target.closest(".model-card");
  if (!card) return;
  modelCards.querySelectorAll(".model-card").forEach((c) => c.classList.remove("active"));
  card.classList.add("active");
  selectedModel = card.dataset.model;
});

// ── Stems Selection ──
stemsCards.addEventListener("click", (e) => {
  const card = e.target.closest(".stem-card");
  if (!card) return;
  stemsCards.querySelectorAll(".stem-card").forEach((c) => c.classList.remove("active"));
  card.classList.add("active");
  selectedStems = card.dataset.stems;
});

// ── Upload Zone — Click ──
uploadZone.addEventListener("click", (e) => {
  // Don't open file dialog if clicking remove button
  if (e.target.closest("#fileRemove")) return;
  fileInput.click();
});

// ── Upload Zone — Drag & Drop ──
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("drag-over");
});
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

// ── File Input Change ──
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
  }
});

// ── Handle File ──
function handleFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const allowed = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma"];
  if (!allowed.includes(ext)) {
    alert(`Formato .${ext} não suportado.\nUse: ${allowed.join(", ")}`);
    return;
  }
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatSize(file.size);
  uploadContent.style.display = "none";
  fileInfo.style.display = "flex";
  btnSplit.disabled = false;
}

// ── Remove File ──
fileRemove.addEventListener("click", (e) => {
  e.stopPropagation();
  resetUpload();
});

function resetUpload() {
  selectedFile = null;
  fileInput.value = "";
  uploadContent.style.display = "";
  fileInfo.style.display = "none";
  btnSplit.disabled = true;
}

// ── Split Button ──
btnSplit.addEventListener("click", async () => {
  if (!selectedFile) return;

  // Show processing
  hideAll();
  processingSection.style.display = "block";
  processingFile.textContent = selectedFile.name;
  progressFill.style.width = "0%";
  progressText.textContent = "Enviando arquivo...";
  btnSplit.disabled = true;

  const formData = new FormData();
  formData.append("audio", selectedFile);
  formData.append("model", selectedModel);
  formData.append("stems", selectedStems);

  try {
    const res = await fetch("/api/separate", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Erro ao enviar");

    progressText.textContent = "Processando com Demucs AI...";
    pollStatus(data.jobId);
  } catch (err) {
    showError(err.message);
  }
});

// ── Poll Job Status ──
function pollStatus(jobId) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const job = await res.json();

      if (job.status === "processing") {
        const pct = job.progress || 0;
        progressFill.style.width = `${pct}%`;
        progressText.textContent = pct > 0
          ? `Separando stems... ${pct}%`
          : "Processando com Demucs AI... (pode levar alguns minutos)";
      }

      if (job.status === "done") {
        clearInterval(interval);
        showResults(job);
      }

      if (job.status === "error") {
        clearInterval(interval);
        showError(job.error || "Erro desconhecido no processamento");
      }
    } catch {
      // Network error, keep polling
    }
  }, 1500);
}

// ── Show Results ──
function showResults(job) {
  hideAll();
  resultsSection.style.display = "block";
  resultsTime.textContent = `Processado em ${job.duration}s com ${job.model}`;

  stemsGrid.innerHTML = "";

  for (const file of job.files) {
    const div = document.createElement("div");
    div.className = "stem-result";
    div.innerHTML = `
      <span class="stem-result-icon">${file.icon}</span>
      <div class="stem-result-info">
        <p class="stem-result-name">${file.label}</p>
        <p class="stem-result-size">${formatSize(file.size)}</p>
      </div>
      <div class="stem-result-actions">
        <button type="button" class="btn-play" data-url="${file.url}" title="Play/Pause">▶</button>
        <a href="${file.url}" download class="btn-download" title="Download">⬇</a>
      </div>
    `;
    stemsGrid.appendChild(div);
  }

  // Play buttons
  stemsGrid.querySelectorAll(".btn-play").forEach((btn) => {
    btn.addEventListener("click", () => togglePlay(btn));
  });

  // Reset upload for next use
  resetUpload();
}

// ── Audio Play/Pause ──
function togglePlay(btn) {
  const url = btn.dataset.url;

  // If clicking same button, toggle
  if (currentAudio && currentPlayBtn === btn) {
    if (currentAudio.paused) {
      currentAudio.play();
      btn.textContent = "⏸";
    } else {
      currentAudio.pause();
      btn.textContent = "▶";
    }
    return;
  }

  // Stop previous
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    if (currentPlayBtn) currentPlayBtn.textContent = "▶";
  }

  // Play new
  currentAudio = new Audio(url);
  currentPlayBtn = btn;
  btn.textContent = "⏸";
  currentAudio.play();
  currentAudio.addEventListener("ended", () => {
    btn.textContent = "▶";
    currentAudio = null;
    currentPlayBtn = null;
  });
}

// ── Show Error ──
function showError(msg) {
  hideAll();
  errorSection.style.display = "block";
  errorMessage.textContent = msg;
}

// ── Retry ──
btnRetry.addEventListener("click", () => {
  hideAll();
  resetUpload();
});

// ── Helpers ──
function hideAll() {
  processingSection.style.display = "none";
  resultsSection.style.display = "none";
  errorSection.style.display = "none";
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
