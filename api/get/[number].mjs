// netlify/functions/get.mjs
// GET /api/get/:number — returns a single cotización

import { db, isAdmin, getCurrentUser, json, preflight, withWeb } from "../_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const number = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(number) || number <= 0) {
    return json({ ok: false, error: "Folio inválido" }, 400);
  }

  const rows = await db().sql`
    SELECT number, status, client, items, terms, vendor, totals,
           created_by, last_edited_by, notes, ot,
           saved_at, created_at
      FROM cotizaciones WHERE number = ${number}
  `;
  if (!rows.length) return json({ ok: false, error: "Cotización no encontrada" }, 404);

  const r = rows[0];

  // Vendor scoping: a 'vendedor' may only view their own cotizaciones.
  // (Master admin password and 'admin' users see everything.)
  if (!isAdmin(req)) {
    const user = await getCurrentUser(req);
    if (user && (user.access_role || "admin") === "vendedor") {
      const owner = ((r.created_by && r.created_by.email) || "").toLowerCase();
      if (owner !== user.email.toLowerCase()) {
        return json({ ok: false, error: "No autorizado" }, 403);
      }
    }
  }

  // Reshape to same JSON the v3 frontend/admin expects
  const cotizacion = {
    number: r.number,
    status: r.status,
    savedAt: r.saved_at instanceof Date ? r.saved_at.toISOString() : r.saved_at,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    createdBy: r.created_by,
    lastEditedBy: r.last_edited_by,
    client: r.client,
    items: r.items,
    terms: r.terms,
    vendor: r.vendor,
    totals: r.totals,
    notes: r.notes,
    ot: r.ot || "",
  };

  return json({ ok: true, cotizacion });
});

