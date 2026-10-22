import express from "express";
import archiver from "archiver";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Script } from "node:vm";

const MAX_FILES = 30;
const MAX_FILE_CHARS = 100000;
const MAX_TOTAL_CHARS = 600000;
const ALLOWED_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".md", ".svg", ".txt"]);

function validateFiles(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) throw new Error("invalid_generated_files");
  const seen = new Set();
  let total = 0;
  const files = value.map((file) => {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") throw new Error("invalid_generated_files");
    const normalized = file.path.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("unsafe_generated_path");
    if (!ALLOWED_EXTENSIONS.has(path.extname(normalized).toLowerCase())) throw new Error("unsupported_generated_file_type");
    if (normalized.length > 180 || file.content.length > MAX_FILE_CHARS || seen.has(normalized)) throw new Error("generated_file_limit_exceeded");
    seen.add(normalized);
    total += file.content.length;
    return { path: normalized, content: file.content };
  });
  if (total > MAX_TOTAL_CHARS || !seen.has("index.html")) throw new Error("generated_project_limit_exceeded_or_missing_index");
  return files;
}

async function generateFiles(prompt, name, type, repairFeedback = "") {
  const base = (process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!base || !key || !model) {
    const error = new Error("llm_not_configured");
    error.code = "llm_not_configured";
    throw error;
  }
  const timeoutMs = Math.max(1000, Math.min(Number(process.env.LLM_TIMEOUT_MS || 60000), 90000));
  const response = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: [
          "You are an expert software engineer generating a complete small static web application. Project type: " + type + ".",
          "Return JSON only: { \"summary\": string, \"files\": [{\"path\": string, \"content\": string}] }.",
          "Generate real complete source files, not a plan. Include index.html, app.css, and app.js where useful.",
          "Use semantic accessible HTML, responsive CSS, and working client-side interactions. Default to Arabic RTL if the user writes Arabic.",
          "Allowed files are only .html, .css, .js, .json, .md, .svg, .txt. Do not include dependencies, shell scripts, server code, secrets, external API keys, or instructions to execute commands.",
          "Keep the project self-contained; do not rely on remote image URLs. Do not claim you ran tests or deployed the project.",
          "This generator currently outputs static web frontend files only; do not pretend to create a working backend, database service, native APK, OCR pipeline, or deployment configuration."
        ].join("\n") },
        { role: "user", content: "Project name: " + name + "\nProject type: " + type + "\nUser requirements:\n" + prompt + (repairFeedback ? "\n\nThe previous generated JavaScript failed syntax validation. Fix these errors and return the complete corrected project files, not a patch:\n" + repairFeedback : "") }
      ]
    })
  });
  if (!response.ok) {
    const error = new Error("llm_provider_error");
    error.code = "llm_provider_error";
    throw error;
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 700000) {
    const error = new Error("invalid_model_response");
    error.code = "invalid_model_response";
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(content); } catch {
    const error = new Error("invalid_model_response");
    error.code = "invalid_model_response";
    throw error;
  }
  return { summary: String(parsed.summary || "تم إنشاء ملفات المشروع."), files: validateFiles(parsed.files) };
}

function validateJavaScriptFiles(files) {
  const errors = [];
  for (const file of files) {
    if (path.extname(file.path).toLowerCase() !== ".js") continue;
    try {
      // Compile only: never execute model-generated JavaScript on the API server.
      new Script(file.content, { filename: file.path });
    } catch (error) {
      errors.push(file.path + ": " + String(error.message).slice(0, 240));
    }
  }
  return errors;
}

export function createProjectRouter({ pool, requireOwner }) {
  const router = express.Router();
  const previews = new Map();
  const previewLifetimeMs = 5 * 60 * 1000;
  function findPreview(token) {
    const entry = previews.get(token);
    if (!entry || entry.expiresAt <= Date.now()) { previews.delete(token); return null; }
    return entry;
  }
  function cleanPreviews() {
    const now = Date.now();
    for (const [key, value] of previews) if (value.expiresAt <= now) previews.delete(key);
    while (previews.size > 200) previews.delete(previews.keys().next().value);
  }

  router.post("/generate", requireOwner, async (req, res) => {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : "مشروعي";
    const allowedTypes = new Set(["app", "platform", "book_to_app", "general"]);
    const type = allowedTypes.has(req.body?.type) ? req.body.type : "app";
    if (!prompt || prompt.length > 12000) return res.status(400).json({ error: "prompt_must_be_1_to_12000_characters", requestId: req.requestId });
    if (!pool) return res.status(503).json({ error: "database_not_configured", requestId: req.requestId });
    const id = randomUUID();
    let projectDir;
    try {
      let generated;
      let syntaxErrors = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        generated = await generateFiles(prompt, name, type, syntaxErrors.join("\\n"));
        syntaxErrors = validateJavaScriptFiles(generated.files);
        if (syntaxErrors.length === 0) break;
      }
      if (syntaxErrors.length) {
        const error = new Error("generated_javascript_syntax_invalid");
        error.code = "generated_javascript_syntax_invalid";
        throw error;
      }
      const workspace = path.resolve(process.env.PROJECT_WORKSPACE || "./workspace/projects");
      projectDir = path.resolve(workspace, id);
      if (!projectDir.startsWith(workspace + path.sep)) return res.status(400).json({ error: "unsafe_project_path", requestId: req.requestId });
      await mkdir(projectDir, { recursive: true, mode: 0o700 });
      for (const file of generated.files) {
        const target = path.resolve(projectDir, file.path);
        if (!target.startsWith(projectDir + path.sep)) throw new Error("unsafe_generated_path");
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, file.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      }
      await pool.query(
        "INSERT INTO agent_projects (id, name, prompt, summary, files, status) VALUES ($1,$2,$3,$4,$5,'generated')",
        [id, name, prompt, generated.summary, JSON.stringify(generated.files)]
      );
      await pool.query(
        "INSERT INTO agent_audit_events (event_type, task_id, request_id, details) VALUES ($1,NULL,$2,$3)",
        ["project.files_generated", req.requestId, JSON.stringify({ projectId: id, fileCount: generated.files.length })]
      );
      res.status(201).json({
        projectId: id, status: "generated", summary: generated.summary,
        files: generated.files.map(({ path: filePath, content }) => ({ path: filePath, size: Buffer.byteLength(content) })),
        nextStep: "files_created_not_executed", requestId: req.requestId
      });
    } catch (error) {
      const rawCode = error.code || error.message;
      const known = ["llm_not_configured", "llm_provider_error", "invalid_model_response", "invalid_generated_files",
        "unsafe_generated_path", "unsupported_generated_file_type", "generated_file_limit_exceeded",
        "generated_project_limit_exceeded_or_missing_index", "generated_javascript_syntax_invalid"];
      const code = known.includes(rawCode) ? rawCode : (error.name === "TimeoutError" ? "llm_timeout" : "project_generation_failed");
      res.status(code === "llm_not_configured" ? 503 : 502).json({ error: code, requestId: req.requestId });
    }
  });

  router.post("/:id/preview", requireOwner, async (req, res) => {
    if (!pool) return res.status(503).json({ error: "database_not_configured", requestId: req.requestId });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "invalid_project_id", requestId: req.requestId });
    try {
      const result = await pool.query("SELECT files FROM agent_projects WHERE id=$1", [req.params.id]);
      if (!result.rowCount) return res.status(404).json({ error: "project_not_found", requestId: req.requestId });
      cleanPreviews();
      const token = randomBytes(32).toString("hex");
      previews.set(token, { files: Array.isArray(result.rows[0].files) ? result.rows[0].files : [], expiresAt: Date.now() + previewLifetimeMs });
      res.status(201).json({ url: "/api/projects/preview/" + token, expiresInSeconds: 300, requestId: req.requestId });
    } catch {
      res.status(503).json({ error: "persistence_unavailable", requestId: req.requestId });
    }
  });

  router.get("/preview/:token/app.css", (req, res) => {
    const preview = findPreview(req.params.token);
    if (!preview) return res.status(404).type("text").send("Preview expired");
    const file = preview.files.find((item) => item.path === "app.css");
    res.setHeader("Cache-Control", "no-store");
    res.type("text/css").send(typeof file?.content === "string" ? file.content : "");
  });

  router.get("/preview/:token/app.js", (req, res) => {
    const preview = findPreview(req.params.token);
    if (!preview) return res.status(404).type("text").send("Preview expired");
    const file = preview.files.find((item) => item.path === "app.js");
    res.setHeader("Cache-Control", "no-store");
    res.type("application/javascript").send(typeof file?.content === "string" ? file.content : "");
  });

  router.get("/preview/:token", (req, res) => {
    const preview = findPreview(req.params.token);
    if (!preview) return res.status(404).type("text").send("Preview expired");
    const index = preview.files.find((item) => item.path === "index.html");
    if (typeof index?.content !== "string") return res.status(404).type("text").send("index.html missing");
    let html = index.content;
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
    html = html.replace(/<link\b[^>]*>/gi, "");
    html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
    const cssTag = '<link rel="stylesheet" href="/api/projects/preview/' + req.params.token + '/app.css">';
    const jsTag = '<script defer src="/api/projects/preview/' + req.params.token + '/app.js"></script>';
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (head) => head + cssTag);
    else html = "<head>" + cssTag + "</head>" + html;
    if (/<\/body\s*>/i.test(html)) html = html.replace(/<\/body\s*>/i, jsTag + "</body>");
    else html += jsTag;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.type("html").send(html);
  });

  router.get("/:id/download", requireOwner, async (req, res) => {
    if (!pool) return res.status(503).json({ error: "database_not_configured", requestId: req.requestId });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "invalid_project_id", requestId: req.requestId });
    try {
      const result = await pool.query("SELECT name, files FROM agent_projects WHERE id=$1", [req.params.id]);
      if (!result.rowCount) return res.status(404).json({ error: "project_not_found", requestId: req.requestId });
      const project = result.rows[0];
      const safeName = String(project.name || "project").normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "project";
      res.status(200);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="' + safeName + '.zip"');
      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", () => {
        if (!res.headersSent) res.status(500).json({ error: "archive_failed", requestId: req.requestId });
        else res.destroy();
      });
      archive.pipe(res);
      for (const file of (Array.isArray(project.files) ? project.files : [])) {
        if (typeof file.path === "string" && typeof file.content === "string") archive.append(file.content, { name: file.path });
      }
      await archive.finalize();
    } catch {
      if (!res.headersSent) res.status(503).json({ error: "persistence_unavailable", requestId: req.requestId });
      else res.destroy();
    }
  });

  router.get("/:id/files", requireOwner, async (req, res) => {
    if (!pool) return res.status(503).json({ error: "database_not_configured", requestId: req.requestId });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "invalid_project_id", requestId: req.requestId });
    try {
      const result = await pool.query("SELECT id, name, summary, files, status, created_at FROM agent_projects WHERE id=$1", [req.params.id]);
      if (!result.rowCount) return res.status(404).json({ error: "project_not_found", requestId: req.requestId });
      res.json({ project: result.rows[0], requestId: req.requestId });
    } catch {
      res.status(503).json({ error: "persistence_unavailable", requestId: req.requestId });
    }
  });
  return router;
}
