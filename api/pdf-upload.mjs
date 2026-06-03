// api/pdf-upload.mjs
// POST /api/pdf-upload — guarda el PDF (base64) de una cotización en la base y
// agrega al contacto en GHL una nota con el link al PDF alojado.
// Requiere autenticación de vendedor.

import { db, getCurrentUser, json, preflight, withWeb } from "./_lib.mjs";
import { attachPdfNote } from "./_ghl.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const user = await getCurrentUser(req);
  if (!user) return json({ ok: false, error: "No autenticado" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Body inválido" }, 400); }

  const number = parseInt(body?.number, 10);
  let pdf = String(body?.pdf || "");
  // Acepta dataURI o base64 puro
  const comma = pdf.indexOf("base64,");
  if (comma !== -1) pdf = pdf.slice(comma + 7);
  if (!Number.isFinite(number) || number <= 0) return json({ ok: false, error: "Folio inválido" }, 400);
  if (!pdf || pdf.length < 100) return json({ ok: false, error: "PDF vacío" }, 400);

  // Guardar el PDF y leer el email del cliente
  const rows = await db().sql`
    UPDATE cotizaciones SET pdf_b64 = ${pdf}
    WHERE number = ${number}
    RETURNING client ->> 'email' AS email, ghl_contact_id
  `;
  if (!rows.length) return json({ ok: false, error: "Cotización no encontrada" }, 404);

  const email = rows[0].email || "";
  const contactId = rows[0].ghl_contact_id || null;
  const pdfUrl = `https://equilec.vercel.app/api/pdf/${number}`;

  // Adjuntar nota con el link al PDF en GHL (no rompe si falla)
  let ghl = null;
  if (contactId || email) ghl = await attachPdfNote({ contactId, email, number });

  return json({ ok: true, pdfUrl, ghl });
});
