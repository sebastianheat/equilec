// netlify/functions/save.mjs
// POST /api/save — saves a cotización. If body has no `number`, assigns next folio.
// REQUIRES vendor authentication (Bearer token from /api/auth/login).

import { db, reserveNextNumber, getCurrentUser, json, preflight, withWeb } from "./_lib.mjs";
import { pushCotizacionToGHL } from "./_ghl.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const user = await getCurrentUser(req);
  if (!user) return json({ ok: false, error: "No autenticado" }, 401);

  let body;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "Body inválido (JSON requerido)" }, 400); }

  if (!body || typeof body !== "object") return json({ ok: false, error: "Data requerida" }, 400);
  if (!body.client || !body.client.name) return json({ ok: false, error: "Cliente requerido" }, 400);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return json({ ok: false, error: "Al menos un producto requerido" }, 400);
  }

  // See if we have an existing record (to preserve createdBy, createdAt, status default)
  let number = parseInt(body.number, 10);
  let isNew = false;
  let existing = null;
  if (Number.isFinite(number) && number > 0) {
    const rows = await db().sql`
      SELECT number, status, created_by, created_at
        FROM cotizaciones WHERE number = ${number}
    `;
    existing = rows[0] || null;
  }
  if (!existing) {
    number = await reserveNextNumber();
    isNew = true;
  }

  const status = body.status || existing?.status || "borrador";
  const lastEditedBy = { email: user.email, name: user.name };
  const createdBy = isNew
    ? { email: user.email, name: user.name }
    : (existing?.created_by || { email: user.email, name: user.name });

  const terms = body.terms || {};
  const vendor = body.vendor || {};
  const totals = body.totals || null;
  const notes = body.notes || "";
  const ot = String(body.ot || "").trim();

  if (isNew) {
    await db().sql`
      INSERT INTO cotizaciones
        (number, status, client, items, terms, vendor, totals, created_by, last_edited_by, notes, ot, saved_at, created_at)
      VALUES
        (${number}, ${status}, ${JSON.stringify(body.client)}::jsonb, ${JSON.stringify(body.items)}::jsonb,
         ${JSON.stringify(terms)}::jsonb, ${JSON.stringify(vendor)}::jsonb,
         ${totals ? JSON.stringify(totals) : null}::jsonb,
         ${JSON.stringify(createdBy)}::jsonb, ${JSON.stringify(lastEditedBy)}::jsonb,
         ${notes}, ${ot}, NOW(), NOW())
    `;
  } else {
    await db().sql`
      UPDATE cotizaciones SET
        status = ${status},
        client = ${JSON.stringify(body.client)}::jsonb,
        items = ${JSON.stringify(body.items)}::jsonb,
        terms = ${JSON.stringify(terms)}::jsonb,
        vendor = ${JSON.stringify(vendor)}::jsonb,
        totals = ${totals ? JSON.stringify(totals) : null}::jsonb,
        last_edited_by = ${JSON.stringify(lastEditedBy)}::jsonb,
        notes = ${notes},
        ot = ${ot},
        saved_at = NOW()
      WHERE number = ${number}
    `;
  }

  // Integración Heat Suite (GHL): empuja la cotización a CRM solo al CREARLA
  // (evita oportunidades duplicadas en re-guardados/ediciones). Nunca rompe el guardado.
  let ghl = null;
  if (isNew) {
    ghl = await pushCotizacionToGHL({
      number, ot, client: body.client, terms, totals, vendor, createdBy,
    });
    if (ghl && ghl.ok && ghl.contactId) {
      try { await db().sql`UPDATE cotizaciones SET ghl_contact_id = ${ghl.contactId} WHERE number = ${number}`; } catch { /* no-fatal */ }
    }
  }

  const savedAt = new Date().toISOString();
  return json({ ok: true, number, savedAt, isNew, ghl });
});

