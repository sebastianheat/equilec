// api/_lib.mjs
// Shared helpers used by all functions — v4 (Neon/Postgres backend)
// Ported from Netlify Functions to Vercel Functions. DB driver is now the
// standalone Neon serverless client (replaces @netlify/database).

import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";

// Folio number where the counter starts (used only on fresh DB if migration didn't seed)
export const FOLIO_START = 1501;

// Session TTL: 30 days
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/* ============================================================
   DATABASE — single shared Neon driver per lambda instance
   Reads the connection string from DATABASE_URL (Vercel/Neon).
   Falls back to NETLIFY_DATABASE_URL for backwards-compat.
   ============================================================ */

let _sql;
function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no está configurada");
    _sql = neon(url);
  }
  return _sql;
}

// Keep the same shape the functions expect: db().sql`...`
export function db() {
  return { sql: getSql() };
}

/* ============================================================
   COUNTER (folios) — uses `counters` table, row name='folio'
   ============================================================ */

export async function readCounter() {
  // Tarea 18: el folio parte desde 14.500 (piso). Idempotente — solo sube, nunca baja.
  await db().sql`UPDATE counters SET next_val = GREATEST(next_val, 14500) WHERE name = 'folio'`;
  const rows = await db().sql`SELECT next_val FROM counters WHERE name = 'folio'`;
  if (!rows.length) return FOLIO_START;
  return Number(rows[0].next_val);
}

export async function writeCounter(next) {
  await db().sql`
    INSERT INTO counters (name, next_val) VALUES ('folio', ${next})
    ON CONFLICT (name) DO UPDATE SET next_val = EXCLUDED.next_val
  `;
}

/**
 * Reserve the next folio atomically using a SQL transaction.
 * Returns the number assigned to this caller.
 */
export async function reserveNextNumber() {
  // Tarea 18: piso de folio 14.500. Idempotente — solo sube, nunca baja.
  await db().sql`UPDATE counters SET next_val = GREATEST(next_val, 14500) WHERE name = 'folio'`;
  const [row] = await db().sql`
    UPDATE counters
       SET next_val = next_val + 1
     WHERE name = 'folio'
     RETURNING (next_val - 1) AS assigned
  `;
  if (!row) {
    // Counter row missing — bootstrap and try once more
    await db().sql`INSERT INTO counters (name, next_val) VALUES ('folio', ${FOLIO_START + 1}) ON CONFLICT DO NOTHING`;
    return FOLIO_START;
  }
  return Number(row.assigned);
}

/* ============================================================
   AUTH HELPERS
   ============================================================ */

/** Check admin master auth (env var password). For privileged operations. */
export function isAdmin(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const expected = process.env.EQUILEC_ADMIN_PASSWORD || "equilec2026";
  return token && token === expected;
}

// Keep old name working for backward compat
export const isAuthed = isAdmin;

/** Common JSON response helper. */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/* ============================================================
   VERCEL ADAPTER — Node (req,res)  <->  Web (Request/Response)
   Vercel's Node runtime invokes handlers as (req, res) with a
   Node IncomingMessage. Our handlers are written against the Web
   standard (req.headers.get, req.json(), return Response). This
   wrapper bridges the two so the ported logic stays unchanged.
   ============================================================ */
export function withWeb(handler) {
  return async function (req, res) {
    try {
      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
      const url = `${proto}://${host}${req.url || "/"}`;

      let body;
      const method = (req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        const chunks = [];
        for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
        if (chunks.length) body = Buffer.concat(chunks);
      }

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else if (v != null) headers.set(k, String(v));
      }

      const request = new Request(url, {
        method,
        headers,
        body,
        ...(body ? { duplex: "half" } : {}),
      });

      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((val, key) => res.setHeader(key, val));
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);
    } catch (err) {
      console.error("withWeb handler error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify({ ok: false, error: "Internal Server Error" }));
    }
  };
}

/** CORS / preflight helper. */
export function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}

/* ============================================================
   PASSWORD HASHING (scrypt — built into Node, no extra deps)
   ============================================================ */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  let computed;
  try {
    computed = crypto.scryptSync(password, salt, 64).toString("hex");
  } catch {
    return false;
  }
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(computed, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ============================================================
   HMAC SESSION TOKENS — stateless, multi-device
   Token format: v1.<emailB64>.<expSeconds>.<sigB64>
   ============================================================ */

function getSecret() {
  return process.env.EQUILEC_AUTH_SECRET || "fallback-change-me-please-equilec";
}

const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const b64uDecode = (s) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

export function issueToken(email, ttlSeconds = SESSION_TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const emailB64 = b64u(email.toLowerCase());
  const payload = `v1.${emailB64}.${exp}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest();
  return `${payload}.${b64u(sig)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, emailB64, expStr, sigB64] = parts;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const payload = `v1.${emailB64}.${expStr}`;
  const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest();
  let got;
  try { got = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64"); } catch { return null; }
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  let email;
  try { email = b64uDecode(emailB64); } catch { return null; }
  return { email, exp };
}

/**
 * Get the authenticated user from the request. Returns null if not authed
 * or if the user is inactive / deleted.
 */
export async function getCurrentUser(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const v = verifyToken(token);
  if (!v) return null;
  const rows = await db().sql`
    SELECT email, name, role, access_role, phone, active, created_at, updated_at
      FROM users WHERE email = ${v.email}
  `;
  if (!rows.length) return null;
  const u = rows[0];
  if (u.active === false) return null;
  return u;
}

/* ============================================================
   USER UTILITIES
   ============================================================ */

export function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}
