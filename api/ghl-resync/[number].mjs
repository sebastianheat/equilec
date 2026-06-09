// api/ghl-resync/[number].mjs
// POST /api/ghl-resync/:number — reintenta sincronizar una cotización con GHL.
// Solo admin (password maestro del panel).

import { db, isAdmin, json, preflight, withWeb } from "../_lib.mjs";
import { pushCotizacionToGHL } from "../_ghl.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!isAdmin(req)) return json({ ok: false, error: "No autorizado" }, 401);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const number = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(number) || number <= 0) return json({ ok: false, error: "Folio inválido" }, 400);

  const rows = await db().sql`
    SELECT number, ot, client, terms, vendor, totals, created_by, tipo_cliente, ariba_id, ghl_opp_id
      FROM cotizaciones WHERE number = ${number}
  `;
  if (!rows.length) return json({ ok: false, error: "Cotización no encontrada" }, 404);
  const r = rows[0];

  const ghl = await pushCotizacionToGHL({
    number: r.number,
    ot: r.ot,
    isNew: false,
    tipoCliente: r.tipo_cliente,
    aribaId: r.ariba_id,
    ghlOppId: r.ghl_opp_id,
    client: r.client,
    terms: r.terms,
    totals: r.totals,
    vendor: r.vendor,
    createdBy: r.created_by,
  });

  try {
    const status = ghl?.ok ? `ok:${ghl.oppMode || ""}` : `error:${(ghl && ghl.error) || "desconocido"}`;
    await db().sql`
      UPDATE cotizaciones SET
        ghl_status = ${status.slice(0, 200)},
        ghl_synced_at = NOW(),
        ghl_contact_id = COALESCE(${ghl?.contactId || null}, ghl_contact_id),
        ghl_opp_id = COALESCE(${ghl?.oppId || null}, ghl_opp_id)
      WHERE number = ${number}`;
  } catch { /* no-fatal */ }

  return json({ ok: !!(ghl && ghl.ok), ghl });
});
