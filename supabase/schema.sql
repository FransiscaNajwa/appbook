create extension if not exists pgcrypto;

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  genre text not null,
  total_pages integer check (total_pages is null or total_pages > 0),
  cover_url text,
  summary text check (summary is null or char_length(summary) <= 500),
  source text not null default 'manual' check (source in ('manual', 'api')),
  external_id text,
  status text not null default 'reading' check (status in ('reading', 'finished')),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_logs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  page_reached integer not null check (page_reached >= 0),
  logged_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists reading_logs_book_logged_at_idx on public.reading_logs(book_id, logged_at desc);
create index if not exists books_status_updated_at_idx on public.books(status, updated_at desc);

create table if not exists public.app_settings (
  id integer primary key check (id = 1),
  goal jsonb,
  reminder jsonb not null default '{"enabled": false, "time": "20:00", "days": [1, 2, 3, 4, 5]}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id)
values (1)
on conflict (id) do nothing;

create or replace function public.touch_books_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists books_updated_at on public.books;
create trigger books_updated_at before update on public.books for each row execute function public.touch_books_updated_at();

alter table public.books enable row level security;
alter table public.reading_logs enable row level security;
alter table public.app_settings enable row level security;
