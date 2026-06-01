// netlify/functions/next-number.mjs
// GET /api/next-number — returns the next folio that *will* be assigned (peek only).

import { readCounter, json, preflight } from "./_lib.mjs";

export default async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

  const next = await readCounter();
  return json({ ok: true, next });
};

