// Афиша: премьеры фильмов в мире (последние ~5 месяцев и ~3 месяца вперёд) с датой выхода в России.
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

  // Два запроса к Кинопоиску:
  // 1) скоро: премьера в мире от сегодня до +100 дней, отбор по «ждут» (≥500);
  // 2) уже идёт в мире: премьера за последние 150 дней (сюда попадают фестивальные премьеры
  //    вроде «Прайм-тайма», которые потом выходят в прокат), отбор по оценкам IMDb (≥3000).
  const now = Date.now(), day = 864e5;
  const NOISE = ["!короткометражка", "!документальный", "!концерт", "!реальное ТВ", "!ток-шоу", "!церемония"];
  const FIELDS = ["id", "name", "enName", "alternativeName", "year", "genres", "poster", "premiere", "rating", "votes", "shortDescription", "countries", "movieLength"];
  const query = (from: Date, to: Date, sortField: string, minField: string, min: number) => {
    const p = new URLSearchParams();
    p.set("premiere.world", `${ddmmyyyy(from)}-${ddmmyyyy(to)}`);
    p.set("type", "movie");
    p.set("sortField", sortField);
    p.set("sortType", "-1");
    p.set("limit", "60");
    p.set(minField, `${min}-100000000`);
    for (const g of NOISE) p.append("genres.name", g);
    p.append("notNullFields", "poster.url");
    for (const f of FIELDS) p.append("selectFields", f);
    return p;
  };
  const from = new Date(now - 150 * day), to = new Date(now + 100 * day);
  const ask = async (p: URLSearchParams) => {
    const r = await fetch(`${API}?${p}`, { headers: { "X-API-KEY": token } });
    if (!r.ok) throw new Error(`Кинопоиск ответил ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).docs ?? [];
  };
  let soon: any[], recent: any[];
  try {
    [soon, recent] = await Promise.all([
      ask(query(new Date(now), to, "votes.await", "votes.await", 500)),
      ask(query(from, new Date(now), "votes.imdb", "votes.imdb", 3000)),
    ]);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
  const seenIds = new Set<number>();
  const raw = [...soon, ...recent].filter((d: any) => !seenIds.has(d.id) && seenIds.add(d.id));

  // отдаём только нужное сайту
  const docs = raw.map((d: any) => ({
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
    awaiting: d.votes?.await || null,
    imdbVotes: d.votes?.imdb || null,
    desc: d.shortDescription ?? null,
    len: d.movieLength || null,
  }));
  docs.sort((a: any, b: any) => String(a.world).localeCompare(String(b.world)));
  return json({ from: from.toISOString(), to: to.toISOString(), docs });
});
