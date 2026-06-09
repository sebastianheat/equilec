// api/_ghl.mjs
// Integración con Heat Suite (GoHighLevel). Se usa server-side desde /api/save.
// Credenciales por variables de entorno: GHL_API_TOKEN, GHL_LOCATION_ID.
// Es resiliente: si GHL falla, NUNCA rompe el guardado de la cotización.

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

// Pipeline de ventas
export const GHL_PIPELINE_ID = "CbFA7voSrC9WTGOty5fR";
// Etapas destino según tipo de cliente
export const GHL_STAGE_NORMAL = "aa34bceb-327d-46c1-9c57-d516951ffdae"; // ⚡️ Cotización Enviada
export const GHL_STAGE_CORP   = "e3f1100f-f2ba-4ac1-a547-9fabeb23b1d5"; // Cotización Corporativa
// Campos personalizados de contacto en Heat
const RUT_FIELD_ID   = "Gh19ABEYCNjcGLSjuwXK"; // RUT (sin puntos y con guión)
const ARIBA_FIELD_ID = "aRfULuXeedVyRTENqYoF"; // ID Ariba

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
  const s = String(p).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8) return null;                 // descarta basura (ej. un nombre)
  if (s.startsWith("+")) return "+" + digits;
  if (digits.startsWith("56")) return "+" + digits;   // Chile con prefijo país
  if (digits.length === 9 && digits[0] === "9") return "+56" + digits; // móvil chileno
  return "+" + digits;
}

// Email "placeholder" para clientes corporativos (sin correo): derivado del RUT,
// así Heat deduplica por RUT (mismo RUT → mismo contacto).
function rutToEmail(rut) {
  const clean = String(rut || "").replace(/[^0-9kK-]/g, "").toLowerCase();
  return clean ? `${clean}@corp.equilec.cl` : null;
}

async function upsertContact({ name, companyName, email, phone, customFields }) {
  const body = { locationId: loc(), name: name || "Sin nombre" };
  if (companyName) body.companyName = companyName; // razón social va a "Company"
  if (email) body.email = email;
  const ph = sanitizePhone(phone);
  if (ph) body.phone = ph;
  if (customFields && customFields.length) body.customFields = customFields;
  const d = await call("/contacts/upsert", "POST", body);
  return (d.contact && d.contact.id) || d.id || null;
}

// Match dinámico correo del ejecutivo → user id de Heat (con caché y respaldo).
let _userCache = null;
async function findHeatUserId(email) {
  if (!email) return undefined;
  const lc = email.toLowerCase();
  if (!_userCache) {
    _userCache = {};
    for (const [k, v] of Object.entries(VENDOR_USER_MAP)) _userCache[k.toLowerCase()] = v;
    try {
      const d = await call(`/users/?locationId=${encodeURIComponent(loc())}`, "GET");
      for (const u of (d.users || [])) if (u.email) _userCache[u.email.toLowerCase()] = u.id;
    } catch { /* usa respaldo */ }
  }
  return _userCache[lc] || undefined;
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

async function createOpportunity({ contactId, name, monetaryValue, assignedTo, pipelineStageId }) {
  const body = {
    pipelineId: GHL_PIPELINE_ID,
    locationId: loc(),
    name,
    pipelineStageId: pipelineStageId || GHL_STAGE_NORMAL,
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
    const isCorp = cot.tipoCliente === "corporativo";
    const rut = (client.rut || "").trim();
    const aribaId = (cot.aribaId || "").trim();

    // Email: Normal usa el real; Corporativo usa un placeholder derivado del RUT
    // (sin correo/teléfono reales), lo que además deduplica por RUT.
    let email = (client.email || "").trim();
    if (!email && isCorp) email = rutToEmail(rut) || "";

    // Campos personalizados: RUT siempre; ID Ariba si es corporativo.
    const customFields = [];
    if (rut) customFields.push({ id: RUT_FIELD_ID, field_value: rut });
    if (isCorp && aribaId) customFields.push({ id: ARIBA_FIELD_ID, field_value: aribaId });

    // GHL maneja el contacto como PERSONA ligada a una empresa.
    const personName = (client.contact && client.contact.trim()) || client.name || "Sin nombre";
    const contactId = await upsertContact({
      name: personName,
      companyName: client.name,
      email,
      phone: client.phone,
      customFields,
    });
    if (!contactId) return { ok: false, error: "sin contactId (sin email/teléfono ni RUT para placeholder)" };

    const total = (cot.totals && cot.totals.total) || 0;
    const currency = (cot.terms && cot.terms.currency) || "CLP";
    const hv = isHighValue(total, currency);
    const ownerEmail = ((cot.createdBy && cot.createdBy.email) || (cot.vendor && cot.vendor.email) || "").toLowerCase();
    const assignedTo = await findHeatUserId(ownerEmail);

    const stage = isCorp ? GHL_STAGE_CORP : GHL_STAGE_NORMAL;
    const oppName = isCorp
      ? `${client.name || "Cliente"} · Ariba ${aribaId || "—"} · COT-${cot.number}`
      : `${client.name || "Cliente"} · COT-${cot.number}`;

    let oppId = cot.ghlOppId || null; // oportunidad ya asociada a ESTE folio (edición)
    let oppMode;
    if (oppId) {
      // Edición de un folio ya sincronizado → actualiza su propia oportunidad.
      await updateOpportunity(oppId, { name: oppName, monetaryValue: total, assignedTo });
      oppMode = "updated";
    } else if (isCorp) {
      // Corporativo: crea una oportunidad NUEVA por cada requerimiento.
      oppId = await createOpportunity({ contactId, name: oppName, monetaryValue: total, assignedTo, pipelineStageId: stage });
      oppMode = "created";
    } else {
      // Normal: una oportunidad por cliente (Opción A) → actualiza si existe.
      oppId = await findOpenOpportunity(contactId);
      if (oppId) { await updateOpportunity(oppId, { name: oppName, monetaryValue: total, assignedTo }); oppMode = "updated-cliente"; }
      else { oppId = await createOpportunity({ contactId, name: oppName, monetaryValue: total, assignedTo, pipelineStageId: stage }); oppMode = "created"; }
    }

    const tags = ["cotizador", `moneda-${currency.toLowerCase()}`, isCorp ? "tipo-corporativo" : "tipo-normal"];
    if (hv) tags.push("cotizacion-alto-valor");
    await addContactTags(contactId, tags);

    // Historial: cada cotización suma una nota en el contacto.
    const link = `https://equilec.vercel.app/?load=${cot.number}`;
    const note = [
      `Cotización COT-${cot.number}${cot.isNew === false ? " (actualizada)" : ""}`,
      `Tipo: ${isCorp ? "Corporativo" : "Normal"}`,
      rut ? `RUT: ${rut}` : null,
      isCorp && aribaId ? `ID Ariba: ${aribaId}` : null,
      cot.ot ? `OT: ${cot.ot}` : null,
      client.reference ? `Referencia: ${client.reference}` : null,
      `Moneda: ${currency}`,
      `Total: ${total}`,
      hv ? "⚑ Alto valor — seguimiento prioritario" : null,
      `Ver cotización: ${link}`,
    ].filter(Boolean).join("\n");
    await addNote(contactId, note);

    return { ok: true, contactId, oppId, oppMode, tipo: isCorp ? "corporativo" : "normal", highValue: hv };
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
