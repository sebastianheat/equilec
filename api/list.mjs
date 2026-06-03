// api/list.mjs
// GET /api/list — list cotizaciones.
// Access:
//   - Master admin password (Bearer EQUILEC_ADMIN_PASSWORD) → sees ALL.
//   - Vendor token with access_role 'admin'                  → sees ALL.
//   - Vendor token with access_role 'vendedor'               → sees ONLY their own.
// Each row includes a precomputed lowercase `search` blob so the UI can filter by
// referencia, OT, SKU, N° de parte, cliente, vendedor, etc.

import { db, isAdmin, getCurrentUser, json, preflight, withWeb } from "./_lib.mjs";

function buildSearchBlob(r) {
  const c = r.client || {};
  const v = r.vendor || {};
  const cb = r.created_by || {};
  const parts = [
    r.number, c.name, c.rut, c.reference, r.ot, v.name, cb.name, cb.email,
  ];
  for (const it of (Array.isArray(r.items) ? r.items : [])) {
    parts.push(it.code, it.numeroParte, it.desc);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function shape(r) {
  return {
    number: r.number,
    status: r.status,
    savedAt: r.saved_at instanceof Date ? r.saved_at.toISOString() : r.saved_at,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    createdBy: r.created_by,
    client: r.client || {},
    vendor: r.vendor || {},
    totals: r.totals || null,
    ot: r.ot || "",
    referencia: (r.client && r.client.reference) || "",
    itemCount: Number(r.item_count || 0),
    ghlStatus: r.ghl_status || null,
    search: buildSearchBlob(r),
  };
}

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  // Determine viewer + scope
  let scopeEmail = null; // null = see all
  if (isAdmin(req)) {
    // master password → super admin, see all
  } else {
    const user = await getCurrentUser(req);
    if (!user) return json({ ok: false, error: "No autorizado" }, 401);
    if ((user.access_role || "admin") === "vendedor") scopeEmail = user.email;
  }

  const rows = scopeEmail
    ? await db().sql`
        SELECT number, status, client, items, vendor, totals, created_by, created_at, saved_at, ot, ghl_status,
               jsonb_array_length(items) AS item_count
          FROM cotizaciones
         WHERE created_by ->> 'email' = ${scopeEmail}
         ORDER BY number DESC`
    : await db().sql`
        SELECT number, status, client, items, vendor, totals, created_by, created_at, saved_at, ot, ghl_status,
               jsonb_array_length(items) AS item_count
          FROM cotizaciones
         ORDER BY number DESC`;

  const items = rows.map(shape);
  return json({ ok: true, items, count: items.length });
});
