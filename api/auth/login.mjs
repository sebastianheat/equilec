// netlify/functions/auth-login.mjs
// POST /api/auth/login — vendor login

import { db, normalizeEmail, verifyPassword, issueToken, json, preflight, withWeb } from "../_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Body inválido" }, 400); }

  const email = normalizeEmail(body?.email);
  const password = String(body?.password || "");
  if (!email || !password) return json({ ok: false, error: "Email y contraseña requeridos" }, 400);

  const rows = await db().sql`
    SELECT email, name, role, phone, password_hash, active
      FROM users WHERE email = ${email}
  `;
  const user = rows[0];

  if (!user || user.active === false) {
    await new Promise((r) => setTimeout(r, 350));
    return json({ ok: false, error: "Credenciales inválidas" }, 401);
  }
  if (!verifyPassword(password, user.password_hash)) {
    await new Promise((r) => setTimeout(r, 350));
    return json({ ok: false, error: "Credenciales inválidas" }, 401);
  }

  const token = issueToken(email);
  // Don't leak hash
  return json({
    ok: true,
    token,
    user: { email: user.email, name: user.name, role: user.role, phone: user.phone, active: user.active }
  });
});

