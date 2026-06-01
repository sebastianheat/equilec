// netlify/functions/auth-me.mjs
// GET /api/auth/me — return current authenticated user (or 401)

import { getCurrentUser, json, preflight, withWeb } from "../_lib.mjs";

export default withWeb(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const user = await getCurrentUser(req);
  if (!user) return json({ ok: false, error: "No autenticado" }, 401);

  return json({ ok: true, user });
});

