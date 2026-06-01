// netlify/functions/set-counter.mjs
// POST /api/set-counter — admin-only. Sets the folio counter to a specific value.
// Body: { next: <number> }

import { writeCounter, isAuthed, json, preflight, withWeb } from "./_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!isAuthed(req)) return json({ ok: false, error: "No autorizado" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Body inválido" }, 400); }

  const n = parseInt(body?.next, 10);
  if (!Number.isFinite(n) || n < 1) {
    return json({ ok: false, error: "next debe ser un número entero positivo" }, 400);
  }

  await writeCounter(n);
  return json({ ok: true, next: n });
});

