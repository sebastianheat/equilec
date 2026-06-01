// netlify/functions/users-list.mjs
// GET /api/users/list — admin only

import { db, isAdmin, json, preflight, withWeb } from "../_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!isAdmin(req)) return json({ ok: false, error: "No autorizado" }, 401);

  const rows = await db().sql`
    SELECT email, name, role, phone, active, created_at, updated_at
      FROM users
     ORDER BY name ASC
  `;
  return json({ ok: true, users: rows, count: rows.length });
});

