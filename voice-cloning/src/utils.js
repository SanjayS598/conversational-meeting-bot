import crypto from "node:crypto";

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 10_000_000) {
        reject(httpError(413, "Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, "Request body must be valid JSON."));
      }
    });

    req.on("error", (error) => reject(error));
  });
}

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendBinary(res, statusCode, buffer, contentType, filename) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": buffer.length,
    "Content-Disposition": `inline; filename="${filename}"`
  });
  res.end(buffer);
}

export function httpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

export function requireFields(input, fields) {
  for (const field of fields) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      throw httpError(400, `Missing required field: ${field}`);
    }
  }
}

export function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function compareByPriorityThenTime(a, b) {
  const priorityA = Number(a.priority || 0);
  const priorityB = Number(b.priority || 0);

  if (priorityA !== priorityB) {
    return priorityB - priorityA;
  }

  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

export function estimateSpeechDurationMs(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1200, Math.round((words / 150) * 60_000));
}
