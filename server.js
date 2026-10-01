import express from "express";
import multer from "multer";
import cors from "cors";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/output", express.static(path.join(__dirname, "output")));

// ── Multer config ──
const storage = multer.diskStorage({
  destination: path.join(__dirname, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    const allowed = [".mp3", ".wav", ".flac", ".ogg", ".m4a", ".wma", ".aac"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Formato não suportado: ${ext}`));
  },
});

// ── Active jobs tracking ──
const jobs = new Map();

// ── Health check endpoint ──
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), jobs: jobs.size });
});

// ── Detect Python path (venv in Docker or system) ──
function getPythonCmd() {
  // Docker container has venv at /opt/demucs-env
  const venvPython = "/opt/demucs-env/bin/python3";
  if (process.platform !== "win32" && fs.existsSync(venvPython)) {
    return venvPython;
  }
  return process.platform === "win32" ? "python" : "python3";
}

// ── POST /api/separate ──
app.post("/api/separate", upload.single("audio"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });

  const jobId = randomUUID();
  const inputPath = req.file.path;
  const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
  const model = req.body.model || "htdemucs";
  const stems = req.body.stems || "all"; // "all" | "vocals"
  const outputDir = path.join(__dirname, "output", jobId);

  fs.mkdirSync(outputDir, { recursive: true });

  const job = {
    id: jobId,
    status: "processing",
    progress: 0,
    originalName,
    model,
    stems,
    startedAt: Date.now(),
    outputDir,
    files: [],
    error: null,
  };
  jobs.set(jobId, job);

  // Build demucs command
  const args = [
    "-m", "demucs",
    "-n", model,
    "-o", outputDir,
  ];

  // Two-stems mode (vocals + instrumental only)
  if (stems === "vocals") {
    args.push("--two-stems", "vocals");
  }

  args.push("--mp3"); // output as mp3
  args.push(inputPath);

  // Use venv python in Docker, system python otherwise
  const pythonCmd = getPythonCmd();

  console.log(`\n🎵 Job ${jobId} started`);
  console.log(`   File: ${originalName}`);
  console.log(`   Model: ${model}`);
  console.log(`   Mode: ${stems === "vocals" ? "2 stems (vocals + instrumental)" : "4 stems (full separation)"}`);
  console.log(`   Python: ${pythonCmd}`);
  console.log(`   Command: ${pythonCmd} ${args.join(" ")}\n`);

  const proc = spawn(pythonCmd, args, {
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      VIRTUAL_ENV: "/opt/demucs-env",
    },
  });

  let stderrBuffer = "";

  proc.stdout.on("data", (data) => {
    const line = data.toString().trim();
    if (line) console.log(`   [demucs] ${line}`);
  });

  proc.stderr.on("data", (data) => {
    const line = data.toString().trim();
    stderrBuffer += line + "\n";
    if (line) console.log(`   [demucs] ${line}`);

    // Parse progress from demucs output
    const pctMatch = line.match(/(\d+)%/);
    if (pctMatch) {
      job.progress = parseInt(pctMatch[1]);
    }
  });

  proc.on("close", (code) => {
    // Clean up uploaded file
    try { fs.unlinkSync(inputPath); } catch {}

    if (code !== 0) {
      job.status = "error";
      job.error = stderrBuffer.slice(-500) || `Demucs exited with code ${code}`;
      console.log(`\n❌ Job ${jobId} failed (exit code ${code})`);
      return;
    }

    // Find output files recursively
    const findFiles = (dir) => {
      let results = [];
      if (!fs.existsSync(dir)) return results;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(findFiles(fullPath));
        } else if (/\.(mp3|wav|flac)$/i.test(entry.name)) {
          results.push(fullPath);
        }
      }
      return results;
    };

    const outputFiles = findFiles(outputDir);

    job.files = outputFiles.map((f) => {
      const relativePath = path.relative(path.join(__dirname, "output"), f);
      const stemName = path.basename(f, path.extname(f));

      // Friendly stem labels
      const labels = {
        vocals: "🎤 Vocals (Acapella)",
        no_vocals: "🎸 Instrumental",
        drums: "🥁 Drums",
        bass: "🎸 Bass",
        other: "🎹 Other",
      };

      return {
        name: labels[stemName] || stemName,
        filename: path.basename(f),
        url: `/output/${relativePath.replace(/\\/g, "/")}`,
      };
    });

    job.status = "done";
    job.progress = 100;
    const elapsed = ((Date.now() - job.startedAt) / 1000).toFixed(1);
    console.log(`\n✅ Job ${jobId} completed in ${elapsed}s`);
    console.log(`   Output files: ${job.files.map((f) => f.name).join(", ")}\n`);
  });

  proc.on("error", (err) => {
    job.status = "error";
    job.error = `Falha ao iniciar Demucs: ${err.message}. Verifique se Python e Demucs estão instalados.`;
    console.error(`\n❌ Job ${jobId} spawn error: ${err.message}`);
    try { fs.unlinkSync(inputPath); } catch {}
  });

  res.json({ jobId, status: "processing" });
});

// ── GET /api/status/:jobId ──
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job não encontrado" });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    originalName: job.originalName,
    model: job.model,
    stems: job.stems,
    files: job.files,
    error: job.error,
    elapsed: ((Date.now() - job.startedAt) / 1000).toFixed(1),
  });
});

// ── Cleanup old jobs (every 30 min) ──
setInterval(() => {
  const maxAge = 60 * 60 * 1000; // 1 hour
  for (const [id, job] of jobs) {
    if (Date.now() - job.startedAt > maxAge) {
      // Remove output files
      try {
        fs.rmSync(job.outputDir, { recursive: true, force: true });
      } catch {}
      jobs.delete(id);
    }
  }
}, 30 * 60 * 1000);

// ── Start server ──
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
🎵 ═══════════════════════════════════════════
   AUDIO SPLITTER — Demucs AI
   Vocal & Instrumental Separation
🎵 ═══════════════════════════════════════════

   🌐 URL:     http://localhost:${PORT}
   🐍 Python:  ${getPythonCmd()}
   📁 Output:  ${path.join(__dirname, "output")}

   Modelos disponíveis:
   ⚡ htdemucs     → Hybrid Transformer (rápido)
   🎯 htdemucs_ft  → Fine-tuned (melhor qualidade)

   Pronto para separar músicas! 🚀
  `);
});
