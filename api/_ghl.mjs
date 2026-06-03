// api/_ghl.mjs
// Integración con Heat Suite (GoHighLevel). Se usa server-side desde /api/save.
// Credenciales por variables de entorno: GHL_API_TOKEN, GHL_LOCATION_ID.
// Es resiliente: si GHL falla, NUNCA rompe el guardado de la cotización.

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

// Pipeline + etapa destino (Oportunidades de Venta → ⚠️ Solicita Cotización)
export const GHL_PIPELINE_ID = "CbFA7voSrC9WTGOty5fR";
export const GHL_STAGE_SOLICITA = "9b8221ab-2bb4-4ef5-b329-4261d2bae5ea";

// Mapa correo del vendedor (cotizador) → user id en GHL (para asignar dueño)
export const VENDOR_USER_MAP = {
  "acruz@equilec.cl": "jc76ZjIpKWh2PJikaBow",
  "egonzalez@equilec.cl": "JBMUbTIoCEoJBOUyY89G",
  "giovanni.benjamin@equilec.cl": "Bi9VOEbkEfn61ShK5T79",
  "gquezada@equilec.cl": "9y11j73jWe7QveKyscwK",
  "sig@equilec.cl": "9GzUupak0zU1ixq1LZNw",
};

const token = () => process.env.GHL_API_TOKEN;
const loc = () => process.env.GHL_LOCATION_ID;
export function ghlEnabled() { return !!(token() && loc()); }

function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    Version: VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function call(path, method, body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) throw new Error(`GHL ${method} ${path} → ${r.status}: ${text.slice(0, 180)}`);
    return data;
  } finally {
    clearTimeout(t);
  }
}

/** Regla de alto valor (currency-aware): CLP ≥ 2.000.000 · USD ≥ 2.000 · EUR ≥ 2.000 */
export function isHighValue(total, currency) {
  const t = Number(total) || 0;
  if (currency === "USD" || currency === "EUR") return t >= 2000;
  return t >= 2000000; // CLP
}

function sanitizePhone(p) {
  if (!p) return null;
  const cleaned = String(p).replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  return digits.length >= 7 ? cleaned : null; // descarta basura (ej. un nombre en el campo "Contacto")
}

async function upsertContact({ name, email, phone }) {
  const body = { locationId: loc(), name: name || "Sin nombre" };
  if (email) body.email = email;
  const ph = sanitizePhone(phone);
  if (ph) body.phone = ph;
  const d = await call("/contacts/upsert", "POST", body);
  return (d.contact && d.contact.id) || d.id || null;
}

// Find-opportunity (Opción A): una sola oportunidad por cliente.
async function findOpenOpportunity(contactId) {
  try {
    const d = await call(
      `/opportunities/search?location_id=${encodeURIComponent(loc())}&contact_id=${encodeURIComponent(contactId)}&pipeline_id=${GHL_PIPELINE_ID}`,
      "GET"
    );
    const list = d.opportunities || [];
    const found = list.find((o) => o.status === "open") || list[0];
    return found ? found.id : null;
  } catch {
    return null;
  }
}

async function createOpportunity({ contactId, name, monetaryValue, assignedTo }) {
  const body = {
    pipelineId: GHL_PIPELINE_ID,
    locationId: loc(),
    name,
    pipelineStageId: GHL_STAGE_SOLICITA,
    status: "open",
    contactId,
    monetaryValue: Math.round(Number(monetaryValue) || 0),
  };
  if (assignedTo) body.assignedTo = assignedTo;
  const d = await call("/opportunities/", "POST", body);
  return (d.opportunity && d.opportunity.id) || d.id || null;
}

async function updateOpportunity(oppId, { name, monetaryValue, assignedTo }) {
  const body = { name, monetaryValue: Math.round(Number(monetaryValue) || 0) };
  if (assignedTo) body.assignedTo = assignedTo;
  // No tocamos la etapa: respetamos dónde la haya movido el equipo de ventas.
  await call(`/opportunities/${oppId}`, "PUT", body);
  return oppId;
}

async function addContactTags(contactId, tags) {
  if (!tags || !tags.length) return;
  try { await call(`/contacts/${contactId}/tags`, "POST", { tags }); } catch { /* non-fatal */ }
}

async function addNote(contactId, noteBody) {
  try { await call(`/contacts/${contactId}/notes`, "POST", { body: noteBody }); } catch { /* non-fatal */ }
}

/**
 * Empuja una cotización recién creada a GHL: upsert contacto + crea oportunidad
 * + tags (moneda / alto valor) + nota con folio/OT/referencia/link.
 * Resiliente: devuelve { ok, ... } y nunca lanza.
 */
export async function pushCotizacionToGHL(cot) {
  try {
    if (!ghlEnabled()) return { ok: false, skipped: "GHL no configurado" };
    const client = cot.client || {};
    // Contacto: el teléfono real va aparte; NO usamos el nombre del "Contacto".
    const contactId = await upsertContact({
      name: client.name,
      email: client.email,
      phone: client.phone,
    });
    if (!contactId) return { ok: false, error: "sin contactId (cliente sin email/teléfono válido)" };

    const total = (cot.totals && cot.totals.total) || 0;
    const currency = (cot.terms && cot.terms.currency) || "CLP";
    const hv = isHighValue(total, currency);
    const ownerEmail = ((cot.createdBy && cot.createdBy.email) || (cot.vendor && cot.vendor.email) || "").toLowerCase();
    const assignedTo = VENDOR_USER_MAP[ownerEmail] || undefined;

    // Opción A: una oportunidad por cliente. Si ya existe, se actualiza; si no, se crea.
    const oppName = `${client.name || "Cliente"} · COT-${cot.number}`;
    let oppId = await findOpenOpportunity(contactId);
    let oppMode;
    if (oppId) {
      await updateOpportunity(oppId, { name: oppName, monetaryValue: total, assignedTo });
      oppMode = "updated";
    } else {
      oppId = await createOpportunity({ contactId, name: oppName, monetaryValue: total, assignedTo });
      oppMode = "created";
    }

    const tags = ["cotizador", `moneda-${currency.toLowerCase()}`];
    if (hv) tags.push("cotizacion-alto-valor");
    await addContactTags(contactId, tags);

    // Historial: cada cotización suma una nota en el contacto.
    const link = `https://equilec.vercel.app/?load=${cot.number}`;
    const note = [
      `Cotización COT-${cot.number}`,
      client.rut ? `RUT: ${client.rut}` : null,
      cot.ot ? `OT: ${cot.ot}` : null,
      client.reference ? `Referencia: ${client.reference}` : null,
      `Moneda: ${currency}`,
      `Total: ${total}`,
      hv ? "⚑ Alto valor — seguimiento prioritario" : null,
      `Ver cotización: ${link}`,
    ].filter(Boolean).join("\n");
    await addNote(contactId, note);

    return { ok: true, contactId, oppId, oppMode, highValue: hv };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** Busca un contacto por email exacto. Devuelve su id o null. */
async function searchContactByEmail(email) {
  if (!email) return null;
  try {
    const d = await call("/contacts/search", "POST", {
      locationId: loc(),
      query: email,
      pageLimit: 5,
    });
    const list = d.contacts || [];
    const lc = email.toLowerCase();
    const hit = list.find((c) => (c.email || "").toLowerCase() === lc) || list[0];
    return hit ? hit.id : null;
  } catch {
    return null;
  }
}

/**
 * Adjunta al contacto una nota con el link al PDF alojado de la cotización.
 * Busca el contacto por email. Resiliente: nunca lanza.
 */
export async function attachPdfNote({ contactId, email, number }) {
  try {
    if (!ghlEnabled()) return { ok: false, skipped: "GHL no configurado" };
    // Preferimos el contactId guardado; si no, buscamos por email.
    if (!contactId) contactId = await searchContactByEmail(email);
    if (!contactId) return { ok: false, error: "contacto no encontrado" };
    const pdfUrl = `https://equilec.vercel.app/api/pdf/${number}`;
    await addNote(contactId, `📎 PDF cotización COT-${number}: ${pdfUrl}`);
    return { ok: true, contactId, pdfUrl };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
