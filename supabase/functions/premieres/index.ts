// Афиша: премьеры фильмов по миру за ближайшие ~3 месяца с датой выхода в России.
// Берёт данные из того же Кинопоиск-API, что и функция kp (ключ KP_TOKEN из секретов проекта).
// Пускает только вошедших в «Наше кино» (проверяет токен пользователя, как kp).
// Отдельная функция, чтобы не трогать рабочую kp.

const API = "https://api.poiskkino.dev/v1.4/movie";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ddmmyyyy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // только для вошедших
  const auth = req.headers.get("Authorization") ?? "";
  const user = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!user.ok) return json({ error: "Нужно войти" }, 401);

  const token = Deno.env.get("KP_TOKEN");
  if (!token) return json({ error: "Нет ключа Кинопоиска" }, 500);

  // окно: две недели назад (фильм мог уже выйти в мире) и 100 дней вперёд
  const from = new Date(Date.now() - 14 * 864e5), to = new Date(Date.now() + 100 * 864e5);
  const p = new URLSearchParams();
  p.set("premiere.world", `${ddmmyyyy(from)}-${ddmmyyyy(to)}`);
  p.set("type", "movie");
  p.set("sortField", "votes.await");
  p.set("sortType", "-1");
  p.set("limit", "80");
  // шум отсекаем: только то, что ждут хотя бы 500 человек на Кинопоиске, без короткого метра, документалок и концертов
  p.set("votes.await", "500-100000000");
  for (const g of ["!короткометражка", "!документальный", "!концерт", "!реальное ТВ", "!ток-шоу"]) p.append("genres.name", g);
  p.append("notNullFields", "poster.url");
  for (const f of ["id", "name", "enName", "alternativeName", "year", "genres", "poster", "premiere", "rating", "votes", "shortDescription", "countries"])
    p.append("selectFields", f);

  const r = await fetch(`${API}?${p}`, { headers: { "X-API-KEY": token } });
  if (!r.ok) return json({ error: `Кинопоиск ответил ${r.status}`, detail: (await r.text()).slice(0, 300) }, 502);
  const data = await r.json();

  // отдаём только нужное сайту
  const docs = (data.docs ?? []).map((d: any) => ({
    id: d.id,
    t: d.name || d.alternativeName || d.enName,
    o: d.alternativeName || d.enName || "",
    y: d.year ?? null,
    g: (d.genres ?? []).map((x: any) => x.name),
    poster: d.poster?.previewUrl || d.poster?.url || null,
    world: d.premiere?.world ?? null,
    russia: d.premiere?.russia ?? null,
    kp: d.rating?.kp || null,
    imdb: d.rating?.imdb || null,
    awaiting: d.votes?.await ?? null,
    desc: d.shortDescription ?? null,
  }));
  docs.sort((a: any, b: any) => String(a.world).localeCompare(String(b.world)));
  return json({ from: from.toISOString(), to: to.toISOString(), docs });
});
