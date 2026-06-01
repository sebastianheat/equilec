// netlify/functions/delete.mjs
// DELETE /api/delete/:number — delete a cotización (admin auth)

import { db, isAuthed, json, preflight, withWeb } from "../_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "DELETE" && req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!isAuthed(req)) return json({ ok: false, error: "No autorizado" }, 401);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const number = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(number) || number <= 0) return json({ ok: false, error: "Folio inválido" }, 400);

  await db().sql`DELETE FROM cotizaciones WHERE number = ${number}`;
  return json({ ok: true, deleted: number });
});

