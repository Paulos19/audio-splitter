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

  // Use python3 (works on both local and Docker)
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  console.log(`\n🎵 Job ${jobId} started`);
  console.log(`   File: ${originalName}`);
  console.log(`   Model: ${model}`);
  console.log(`   Mode: ${stems === "vocals" ? "2 stems (vocals + instrumental)" : "4 stems (all)"}`);
  console.log(`   Command: ${pythonCmd} ${args.join(" ")}`);

  const proc = spawn(pythonCmd, args, { cwd: __dirname });

  let lastLog = "";

  proc.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) {
      lastLog = text;
      // Parse progress from demucs output
      const pctMatch = text.match(/(\d+)%/);
      if (pctMatch) {
        job.progress = parseInt(pctMatch[1]);
      }
      console.log(`   [demucs] ${text}`);
    }
  });

  proc.stdout.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.log(`   [demucs] ${text}`);
  });

  proc.on("close", (code) => {
    // Cleanup uploaded file
    try { fs.unlinkSync(inputPath); } catch {}

    if (code !== 0) {
      job.status = "error";
      job.error = lastLog || `Demucs exited with code ${code}`;
      console.log(`   ❌ Job ${jobId} failed: ${job.error}`);
      return;
    }

    // Find output files recursively
    const findFiles = (dir) => {
      const results = [];
      if (!fs.existsSync(dir)) return results;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findFiles(fullPath));
        } else if (/\.(mp3|wav|flac)$/i.test(entry.name)) {
          results.push(fullPath);
        }
      }
      return results;
    };

    const outputFiles = findFiles(outputDir);
    job.files = outputFiles.map((f) => {
      const rel = path.relative(path.join(__dirname, "output"), f).replace(/\\/g, "/");
      const stemName = path.basename(f, path.extname(f));
      return {
        name: stemName,
        filename: path.basename(f),
        url: `/output/${rel}`,
        size: fs.statSync(f).size,
      };
    });

    job.status = "done";
    job.progress = 100;
    const elapsed = ((Date.now() - job.startedAt) / 1000).toFixed(1);
    console.log(`   ✅ Job ${jobId} completed in ${elapsed}s — ${job.files.length} stems`);
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

// ── GET /api/gallery ──
app.get("/api/gallery", (req, res) => {
  const allJobs = Array.from(jobs.values())
    .filter((j) => j.status === "done")
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
  res.json(allJobs);
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);
  res.status(500).json({ error: err.message });
});

// ── Ensure directories exist ──
fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "output"), { recursive: true });

// ── Start ──
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
🎵 ═══════════════════════════════════════════
   AUDIO SPLITTER
   AI-Powered Music Source Separation
🎵 ═══════════════════════════════════════════

   🌐 URL:     http://localhost:${PORT}
   🧠 Engine:  Demucs (Meta AI)
   📁 Output:  ${path.join(__dirname, "output")}

   Modelos disponíveis:
   ⚡ htdemucs    — Hybrid Transformer (rápido)
   🎯 htdemucs_ft — Fine-tuned (melhor qualidade)

   Pronto para separar músicas! 🚀
`);
});
