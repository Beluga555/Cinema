// Сеансы в наших кинотеатрах: «Синема 5» (Броско Молл) и «М-Синема» (Максимолл).
// Берёт расписание прямо с их сайтов и отдаёт сайту одним списком фильмов с сеансами.
// Пускает только вошедших в «Наше кино» (проверяет токен пользователя, как kp и premieres).
// Отдельная функция, чтобы не трогать kp и premieres.
//
// Источники (разобраны 12.11.2026):
//   Синема 5: открытое API их сайта cinema5.ru, ключ не нужен. Кинотеатр Хабаровска = cinemaIds=26.
//   М-Синема: сайт mcinema.ru на системе Kinoplan, кинотеатр 8411, город 121.
//             Kinoplan пускает только с пропуском сайта: секрет MCINEMA_TOKEN в Supabase.
//             Если пропуск сменят, раздел М-Синемы вернёт ошибку, остальное продолжит работать.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const C5 = "https://cinema5.ru/api/v1";
const C5_CINEMA = 26;
const KK = "https://kinokassa.kinoplan24.ru/api/v2";
const MC_CITY = 121, MC_CINEMA = 8411;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36", "Accept": "application/json" };

type Show = { c: "c5" | "mc"; at: string; hall: string; kind: string; fmt: string; price: number | null; url: string };
type Trailer = { url: string; thumb: string | null };
type Film = { key: string; t: string; age: string | null; g: string[]; poster: string | null; rerun: boolean; year?: number | null; trailer: Trailer | null; shows: Show[] };

// «Гарри Поттер и Тайная комната предсеанс. обсл. & Матч Акпарса» → «Гарри Поттер и Тайная комната»
const cleanTitle = (s: string) => s.replace(/\s+предсеанс\..*$/i, "").replace(/\s+/g, " ").trim();
export const norm = (s: string) =>
  cleanTitle(s).toLowerCase().replace(/ё/g, "е").replace(/[«»"'.,:;!?()\-–—]/g, " ").replace(/\s+/g, " ").trim();

async function getJSON(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers } });
  if (!r.ok) throw new Error(`${new URL(url).host} ответил ${r.status}`);
  return r.json();
}

// ---------- Синема 5 ----------
async function cinema5(): Promise<Film[]> {
  const dates: string[] = (await getJSON(`${C5}/movies/dates?cinemaIds=${C5_CINEMA}`)).items ?? [];
  const days = await Promise.all(dates.map((d) => getJSON(`${C5}/movies/date/${d}?cinemaIds=${C5_CINEMA}`)));
  const out = new Map<string, Film>();
  for (const day of days) for (const m of day.items ?? []) {
    const rerun = /предсеанс\./i.test(m.name);
    const key = norm(m.name);
    const f = out.get(key) ?? {
      key, t: cleanTitle(m.name), age: m.ageLimit != null ? `${m.ageLimit}+` : null,
      g: rerun ? [] : (m.genres ?? []).map((x: string) => x.trim()).filter(Boolean),
      poster: m.vposter || null, rerun, trailer: m.trailer ? { url: m.trailer, thumb: null } : null, shows: [],
    };
    for (const s of m.shows ?? []) {
      const cat = String(s.hallCategory ?? "");
      f.shows.push({
        c: "c5", at: `${s.date}T${s.time}`, hall: `Зал ${s.hallName}`,
        kind: /imax/i.test(cat) ? "IMAX" : /vip/i.test(cat) ? "VIP" : "", // «Стандарт»/«Комфорт» не пишем, чтобы не засорять кнопки
        fmt: s.formatName ?? "", price: s.minPrice ?? null,
        url: `https://cinema5.ru/khabarovsk/movie/${m.slug}#/show/${C5_CINEMA}/${s.id}`,
      });
    }
    out.set(key, f);
  }
  return [...out.values()];
}

// ---------- М-Синема (Kinoplan) ----------
async function mcinema(): Promise<Film[]> {
  const token = Deno.env.get("MCINEMA_TOKEN");
  if (!token) throw new Error("нет секрета MCINEMA_TOKEN");
  const H = { "X-Application-Token": token, "X-Platform": "widget" };
  const info = await getJSON(`${KK}/release/playbill/info?city_id=${MC_CITY}`, H);
  const dates: string[] = info.calendar?.seance_dates ?? [];
  const days = await Promise.all(dates.map((d) =>
    getJSON(`${KK}/release/playbill/flatten?city_id=${MC_CITY}&date=${d}&cinema_id=${MC_CINEMA}`, H)));
  const out = new Map<string, Film>();
  for (const day of days) {
    const rel = new Map<number, any>((day.releases ?? []).map((r: any) => [r.id, r]));
    for (const s of day.seances ?? []) {
      if (s.cinema_id !== MC_CINEMA) continue;
      const r = rel.get(s.release_id); if (!r) continue;
      const key = norm(r.title);
      const f = out.get(key) ?? {
        key, t: cleanTitle(r.title), age: r.age_rating || null,
        g: (r.genres ?? []).map((x: any) => x.title ?? x).filter(Boolean),
        poster: r.poster || r.thumbnail || null, rerun: false, year: r.year ?? null, trailer: null, shows: [], rid: r.id,
      } as Film & { rid?: number };
      const time = String(s.start_date_time).slice(11, 16);
      const hallTitle = String(s.hall?.title ?? "");
      f.shows.push({
        c: "mc", at: `${s.start_date}T${time}`, hall: `Зал ${hallTitle.replace(/\(VIP\)/i, "").trim()}`,
        kind: s.hall?.is_vip || /vip/i.test(hallTitle) ? "VIP" : "",
        fmt: (s.formats ?? []).map((x: any) => x.title).join(", "),
        price: s.price?.min != null ? Math.round(s.price.min / 100) : null,
        url: `https://mcinema.ru/release/${s.release_id}?date=${s.start_date}`,
      });
      out.set(key, f);
    }
  }
  // трейлеры: у Kinoplan они лежат в карточке релиза, по запросу на фильм (≈15–20 запросов раз в 30 минут)
  const list = [...out.values()] as (Film & { rid?: number })[];
  await Promise.all(list.map(async (f) => {
    try {
      const d = await getJSON(`${KK}/release/${f.rid}?city_id=${MC_CITY}`, H);
      const t = (d.release ?? d).trailer;
      if (t?.hd) f.trailer = { url: t.hd, thumb: t.thumbnail ?? null };
    } catch { /* без трейлера, не страшно */ }
    delete f.rid;
  }));
  return list;
}

// живёт, пока функция «тёплая»: повторные открытия афиши не дёргают сайты кинотеатров
let cache: { at: number; body: unknown } | null = null;
const TTL = 30 * 60e3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const auth = req.headers.get("Authorization") ?? "";
  const user = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!user.ok) return json({ error: "Нужно войти" }, 401);

  if (cache && Date.now() - cache.at < TTL) return json(cache.body);

  const [a, b] = await Promise.allSettled([cinema5(), mcinema()]);
  const errors: Record<string, string> = {};
  if (a.status === "rejected") errors.c5 = String(a.reason?.message ?? a.reason);
  if (b.status === "rejected") errors.mc = String(b.reason?.message ?? b.reason);

  // склеиваем одинаковые фильмы из двух кинотеатров
  const all = new Map<string, Film>();
  for (const f of [...(a.status === "fulfilled" ? a.value : []), ...(b.status === "fulfilled" ? b.value : [])]) {
    const have = all.get(f.key);
    if (!have) { all.set(f.key, f); continue; }
    have.shows.push(...f.shows);
    if (!have.g.length) have.g = f.g;
    have.year ??= f.year ?? null;
    if (f.trailer && (!have.trailer || f.shows[0]?.c === "mc")) have.trailer = f.trailer; // у Kinoplan трейлеры в HD
    if (have.rerun && !f.rerun) have.poster = f.poster ?? have.poster;
    have.rerun = have.rerun && f.rerun;
  }
  // время сеансов — хабаровское (UTC+10); прошедшие убираем
  const nowKhv = new Date(Date.now() + 10 * 36e5).toISOString().slice(0, 16);
  const films = [...all.values()]
    .map((f) => ({ ...f, shows: f.shows.filter((s) => s.at >= nowKhv).sort((x, y) => x.at.localeCompare(y.at)) }))
    .filter((f) => f.shows.length)
    .sort((x, y) => x.shows[0].at.localeCompare(y.shows[0].at));

  const body = { at: new Date().toISOString(), errors, films };
  if (!errors.c5 && !errors.mc) cache = { at: Date.now(), body };
  return json(body);
});
