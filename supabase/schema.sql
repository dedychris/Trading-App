-- Jalankan sekali di Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- 1) Tabel state bot. RLS aktif tanpa policy → hanya server (service role key) yang bisa baca/tulis.
create table if not exists public.bot_kv (
  key text primary key,
  value jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.bot_kv enable row level security;

-- 2) Cron: panggil bot tiap menit (24 jam, tidak tergantung HP/laptop).
--    GANTI dua nilai di bawah sebelum Run:
--      https://NAMA-APP.vercel.app  → link Vercel app lu
--      ISI_BOT_SECRET               → sama persis dengan BOT_SECRET di Vercel
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('trading-bot-tick') where exists (select 1 from cron.job where jobname = 'trading-bot-tick');
select cron.schedule(
  'trading-bot-tick',
  '* * * * *',
  $$ select net.http_get(
       url := 'https://NAMA-APP.vercel.app/api/bot?action=tick&key=ISI_BOT_SECRET',
       timeout_milliseconds := 55000
     ) $$
);

-- Cek cron jalan (lihat status & error 10 panggilan terakhir):
-- select status_code, left(content, 200), created from net._http_response order by created desc limit 10;
-- Matikan cron:
-- select cron.unschedule('trading-bot-tick');
