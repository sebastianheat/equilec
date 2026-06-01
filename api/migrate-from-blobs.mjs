import { withWeb } from "./_lib.mjs";
// netlify/functions/migrate-from-blobs.mjs
// DEPRECATED — esta función ya cumplió su rol (migración one-shot Blobs → Neon completada).
// Queda como stub 410 Gone para evitar reactivar accidentalmente la lógica de migración.
// La data ahora vive 100% en Neon Postgres.

export default withWeb(async () => {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "Gone",
      message: "Endpoint de migración Blobs→Neon retirado. La migración ya fue completada en v4."
    }),
    {
      status: 410,
      headers: { "content-type": "application/json; charset=utf-8" },
    }
  );
});

