// netlify/functions/list.mjs
// GET /api/list — list all cotizaciones (admin auth required)

import { db, isAuthed, json, preflight, withWeb } from "./_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!isAuthed(req)) return json({ ok: false, error: "No autorizado" }, 401);

  const rows = await db().sql`
    SELECT number, status, client, vendor, totals, created_by, created_at, saved_at,
           jsonb_array_length(items) AS item_count
      FROM cotizaciones
     ORDER BY number DESC
  `;

  const items = rows.map(r => ({
    number: r.number,
    status: r.status,
    savedAt: r.saved_at instanceof Date ? r.saved_at.toISOString() : r.saved_at,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    createdBy: r.created_by,
    client: r.client || {},
    vendor: r.vendor || {},
    totals: r.totals || null,
    itemCount: Number(r.item_count || 0),
  }));

  return json({ ok: true, items, count: items.length });
});

