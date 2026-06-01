// netlify/functions/users-delete.mjs
// DELETE /api/users/delete/:email — admin deletes a user

import { db, isAdmin, normalizeEmail, json, preflight, withWeb } from "../../_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "DELETE" && req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!isAdmin(req)) return json({ ok: false, error: "No autorizado" }, 401);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const email = normalizeEmail(decodeURIComponent(parts[parts.length - 1] || ""));
  if (!email || !email.includes("@")) return json({ ok: false, error: "Email inválido" }, 400);

  await db().sql`DELETE FROM users WHERE email = ${email}`;
  return json({ ok: true, deleted: email });
});

