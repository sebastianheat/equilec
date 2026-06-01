# EQUILEC — Cotizador Dinámico

Cotizador web de EQUILEC. Migrado desde Netlify a **GitHub + Vercel**.

## Arquitectura

- **Frontend estático**: `index.html` (cotizador), `admin.html` (panel admin), `app.js`, `products.json`, `logo-equilec.png`.
- **API serverless** (Vercel Functions, runtime Node, firma Web `Request`/`Response`): carpeta `api/`.
- **Base de datos**: Neon Postgres (serverless). Conexión vía variable de entorno `DATABASE_URL`.
- Lógica compartida en `api/_lib.mjs` (driver Neon, auth por token HMAC, hashing scrypt, contador de folios).

### Endpoints

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/login` | Login de vendedor | — |
| GET  | `/api/auth/me` | Usuario autenticado | token vendedor |
| POST | `/api/save` | Guardar/actualizar cotización | token vendedor |
| GET  | `/api/get/:number` | Obtener una cotización | — |
| GET  | `/api/next-number` | Próximo folio (peek) | — |
| POST | `/api/login` | Login admin (password maestro) | — |
| GET  | `/api/list` | Listar cotizaciones | admin |
| DELETE | `/api/delete/:number` | Borrar cotización | admin |
| POST | `/api/set-counter` | Fijar contador de folios | admin |
| GET  | `/api/users/list` | Listar usuarios | admin |
| POST | `/api/users/save` | Crear/editar usuario | admin |
| DELETE | `/api/users/delete/:email` | Borrar usuario | admin |

## Variables de entorno (Vercel)

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Cadena de conexión Neon Postgres. |
| `EQUILEC_ADMIN_PASSWORD` | Password maestro del panel admin. |
| `EQUILEC_AUTH_SECRET` | Secreto HMAC para tokens de sesión de vendedores. |

## Esquema de base de datos

Ver `db/migrations/001_initial_schema/migration.sql` (tablas `users`, `cotizaciones`, `counters`).

## Desarrollo local

```bash
npm install
vercel dev
```
