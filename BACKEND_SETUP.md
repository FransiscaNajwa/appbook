# Backend Reading Tracker

Backend memakai Netlify Functions dan Supabase PostgreSQL.

## Setup

1. Buat project Supabase.
2. Jalankan [`supabase/schema.sql`](./supabase/schema.sql) di Supabase SQL Editor.
3. Jalankan `npm install` di root project.
4. Salin `.env.example` menjadi `.env` untuk local development.
5. Isi `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSCODE`, dan `ALLOWED_ORIGINS`.
6. Deploy folder ini ke Netlify. `netlify.toml` sudah mengarahkan `/api/*` ke function.

## API

Semua request selain `OPTIONS` harus mengirim header `X-App-Passcode`.

- `GET /api/books`
- `GET /api/settings`
- `POST /api/books`
- `POST /api/books/:bookId/logs`
- `PATCH /api/books/:bookId` dengan body `{ "status": "reading" | "finished" }`
- `PATCH /api/settings` dengan body `{ "goal": object | null, "reminder": object }`

`SUPABASE_SERVICE_ROLE_KEY` hanya boleh disimpan sebagai environment variable server Netlify dan tidak boleh dimasukkan ke frontend.

Frontend menggunakan API sebagai sumber data utama. Cache `localStorage` hanya dipakai untuk tampilan sementara ketika koneksi terputus.
