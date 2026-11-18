# Backend Reading Tracker

Backend memakai Vercel Serverless Functions dan Supabase PostgreSQL.

## Setup

1. Buat project Supabase.
2. Jalankan [`supabase/schema.sql`](./supabase/schema.sql) di Supabase SQL Editor.
3. Jalankan `npm install` di root project.
4. Salin `.env.example` menjadi `.env` untuk local development.
5. Isi `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, dan `ALLOWED_ORIGINS`.
6. Deploy folder ini ke Vercel. `vercel.json` mengarahkan `/api/*` ke serverless function.

Untuk menjalankan lokal, gunakan `npm run dev`.

## API

- `GET /api/books`
- `GET /api/settings`
- `GET /api/health`
- `POST /api/books`
- `POST /api/books/:bookId/logs`
- `PATCH /api/books/:bookId` dengan body `{ "status": "reading" | "finished" }`
- `PATCH /api/settings` dengan body `{ "goal": object | null, "reminder": object }`

`SUPABASE_SERVICE_ROLE_KEY` hanya boleh disimpan sebagai environment variable server Vercel dan tidak boleh dimasukkan ke frontend.

Frontend menggunakan API sebagai sumber data utama. Cache `localStorage` hanya dipakai untuk tampilan sementara ketika koneksi terputus.
