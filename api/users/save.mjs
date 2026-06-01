// netlify/functions/users-save.mjs
// POST /api/users/save — admin creates or updates a user
// Body: { email, name, role, phone, password?, active? }

import { db, isAdmin, hashPassword, normalizeEmail, json, preflight, withWeb } from "../_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!isAdmin(req)) return json({ ok: false, error: "No autorizado" }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Body inválido" }, 400); }

  const email = normalizeEmail(body?.email);
  if (!email || !email.includes("@")) return json({ ok: false, error: "Email inválido" }, 400);

  const name = String(body?.name || "").trim();
  if (!name) return json({ ok: false, error: "Nombre requerido" }, 400);

  // Existing?
  const existingRows = await db().sql`SELECT email, password_hash FROM users WHERE email = ${email}`;
  const existing = existingRows[0];

  const password = body?.password ? String(body.password) : "";
  if (!existing && !password) {
    return json({ ok: false, error: "Contraseña requerida al crear usuario" }, 400);
  }
  if (password && password.length < 6) {
    return json({ ok: false, error: "La contraseña debe tener al menos 6 caracteres" }, 400);
  }

  const role = String(body?.role || "").trim();
  const phone = String(body?.phone || "").trim();
  const active = body?.active !== false;
  // Access role (capability): 'admin' or 'vendedor'. Default 'vendedor' (least privilege).
  const accessRole = String(body?.access_role || "").trim().toLowerCase() === "admin" ? "admin" : "vendedor";
  const passwordHash = password ? hashPassword(password) : existing.password_hash;

  if (!existing) {
    await db().sql`
      INSERT INTO users (email, name, role, access_role, phone, password_hash, active, created_at, updated_at)
      VALUES (${email}, ${name}, ${role}, ${accessRole}, ${phone}, ${passwordHash}, ${active}, NOW(), NOW())
    `;
  } else {
    await db().sql`
      UPDATE users SET
        name = ${name},
        role = ${role},
        access_role = ${accessRole},
        phone = ${phone},
        password_hash = ${passwordHash},
        active = ${active},
        updated_at = NOW()
      WHERE email = ${email}
    `;
  }

  return json({
    ok: true,
    user: { email, name, role, access_role: accessRole, phone, active },
    isNew: !existing,
  });
});

