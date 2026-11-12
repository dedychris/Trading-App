-- Jalankan sekali di Supabase: Dashboard → SQL Editor → New query → paste → Run
create table if not exists public.books (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.books enable row level security;

-- Tiap user hanya bisa baca/tulis datanya sendiri
create policy "books_select_own" on public.books for select using (auth.uid() = user_id);
create policy "books_insert_own" on public.books for insert with check (auth.uid() = user_id);
create policy "books_update_own" on public.books for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "books_delete_own" on public.books for delete using (auth.uid() = user_id);

-- Supaya HP & laptop update real-time
alter publication supabase_realtime add table public.books;
