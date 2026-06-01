// netlify/functions/login.mjs
// POST /api/login — admin login.
// Body: { password }; Response: { ok, token }

import { json, preflight, withWeb } from "./_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "Body inválido" }, 400); }

  const expected = process.env.EQUILEC_ADMIN_PASSWORD || "equilec2026";
  if (!body || body.password !== expected) {
    await new Promise((r) => setTimeout(r, 350));
    return json({ ok: false, error: "Contraseña incorrecta" }, 401);
  }

  return json({ ok: true, token: expected });
});

