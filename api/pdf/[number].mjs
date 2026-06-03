// api/pdf/[number].mjs
// GET /api/pdf/:number — sirve el PDF alojado de una cotización (público, inline).

import { db, withWeb } from "../_lib.mjs";

export default withWeb(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const number = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(number) || number <= 0) {
    return new Response("Folio inválido", { status: 400 });
  }

  const rows = await db().sql`SELECT pdf_b64 FROM cotizaciones WHERE number = ${number}`;
  if (!rows.length || !rows[0].pdf_b64) {
    return new Response("PDF no disponible para esta cotización", { status: 404 });
  }

  const buf = Buffer.from(rows[0].pdf_b64, "base64");
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="COT-${number}.pdf"`,
      "cache-control": "public, max-age=300",
    },
  });
});
