import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 30;
const MAX_FILE_CHARS = 100000;
const MAX_TOTAL_CHARS = 600000;
const ALLOWED_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".md", ".svg", ".txt"]);

function validateFiles(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    throw new Error("invalid_generated_files");
  }
  const seen = new Set();
  let total = 0;
  const files = value.map((file) => {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("invalid_generated_files");
    }
    const normalized = file.path.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("unsafe_generated_path");
    }
    if (!ALLOWED_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
      throw new Error("unsupported_generated_file_type");
    }
    if (normalized.length > 180 || file.content.length > MAX_FILE_CHARS || seen.has(normalized)) {
      throw new Error("generated_file_limit_exceeded");
    }
    seen.add(normalized);
    total += file.content.length;
    return { path: normalized, content: file.content };
  });
  if (total > MAX_TOTAL_CHARS || !seen.has("index.html")) {
    throw new Error("generated_project_limit_exceeded_or_missing_index");
  }
  return files;
}

async function generateFiles(prompt, name) {
  const base = (process.env.LLM_BASE_URL || "").replace(/\\/+$/, "");
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
          "You are an expert software engineer generating a small, complete static web application.",
          "Return JSON only: { \"summary\": string, \"files\": [{\"path\": string, \"content\": string}] }.",
          "Generate real complete source files, not a plan. Include index.html, app.css, and app.js where useful.",
          "Use semantic accessible HTML, responsive CSS, and working client-side interactions. Default to Arabic RTL if the user writes Arabic.",
          "Allowed files are only .html, .css, .js, .json, .md, .svg, .txt. Do not include dependencies, shell scripts, server code, secrets, external API keys, or instructions to execute commands.",
          "Keep the project self-contained; use local assets or CSS shapes instead of relying on remote image URLs.",
          "Do not claim you ran tests or deployed the project. Make all functionality honest and locally usable."
        ].join("\\n") },
        { role: "user", content: "Project name: " + name + "\\nUser requirements:\\n" + prompt }
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

export function createProjectRouter({ pool, requireOwner }) {
  const router = express.Router();

  router.post("/generate", requireOwner, async (req, res) => {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "مشروعي";
    if (!prompt || prompt.length > 12000) {
      return res.status(400).json({ error: "prompt_must_be_1_to_12000_characters", requestId: req.requestId });
    }
    if (!pool) return res.status(503).json({ error: "database_not_configured", requestId: req.requestId });
    const id = randomUUID();
    try {
      const generated = await generateFiles(prompt, name);
      const workspace = path.resolve(process.env.PROJECT_WORKSPACE || "./workspace/projects");
      const projectDir = path.resolve(workspace, id);
      if (!projectDir.startsWith(workspace + path.sep)) {
        return res.status(400).json({ error: "unsafe_project_path", requestId: req.requestId });
      }
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
        nextStep: "files_created_not_executed",
        requestId: req.requestId
      });
    } catch (error) {
      const code = ["llm_not_configured", "llm_provider_error", "invalid_model_response", "invalid_generated_files",
        "unsafe_generated_path", "unsupported_generated_file_type", "generated_file_limit_exceeded",
        "generated_project_limit_exceeded_or_missing_index"].includes(error.code || error.message)
        ? (error.code || error.message) : (error.name === "TimeoutError" ? "llm_timeout" : "project_generation_failed");
      res.status(code === "llm_not_configured" ? 503 : 502).json({ error: code, requestId: req.requestId });
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
