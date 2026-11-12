-- Привязка предпоказов: «М-Синема» продаёт билет на российский фильм (например «Авиарежим»),
-- а перед ним показывает другой («Тайный дневник Верити»). Здесь хранится, какой фильм на самом деле.
-- Видно и меняется только для вошедших (Вова и Ника).
create table if not exists public.film_alias (
  cinema_key text primary key,          -- название из кинотеатра в упрощённом виде, например «авиарежим»
  kp_id      bigint not null,           -- настоящий фильм на Кинопоиске
  title      text,
  poster     text,
  year       int,
  set_by     uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.film_alias enable row level security;
create policy "film_alias read"   on public.film_alias for select to authenticated using (true);
create policy "film_alias insert" on public.film_alias for insert to authenticated with check (true);
create policy "film_alias update" on public.film_alias for update to authenticated using (true) with check (true);
create policy "film_alias delete" on public.film_alias for delete to authenticated using (true);
