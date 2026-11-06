// 原価の計算（純粋な計算だけ。画面や Firebase にはさわらない → node でもためせる：node tools/test-keisan.mjs）
// - 労務費＝日報の時間 × 単価（時間の種類ごと）−（遅刻＋早退）× 引く単価（はじめは「平日工場」）
// - 材料費＝資材便の注文の金額。請求書の金額（seikyu）、まだなら納品書の金額（nouhin）。取り消した注文は数えない
// - 人工＝平日・休日の工場・現場の時間 ÷ 8（日報の管理画面と同じ）
// - 日報の管理画面「工事別工数」と同じく、休み（off）の行は数えない

/** 時間の種類 11こ（日報アプリと同じ名前・同じ順） */
export const KINDS = ["平日工場", "平日現場", "工場残業", "現場残業", "休日工場", "休日現場", "移動行き", "移動帰り", "早出", "深夜", "突発"];
/** 人工に数える種類 */
export const WORK_KINDS = ["平日工場", "平日現場", "休日工場", "休日現場"];
/** 会社の区分（見せる順） */
export const GROUPS = ["自社", "常駐協力", "外注協力"];
/** 持ち場の区分（工場＝製作、現場、その他）。11/4 持ち主：労務費を工場（製作）と現場に分けて見たい */
export const PLACES = ["工場", "現場", "その他"];
/** はじめの単価：1工数（8時間）20,000円 → 1時間 2,500円 */
export const DEFAULT_RATE = 2500;
export const DEFAULT_MINUS = "平日工場";

/** 注番の形：英字2文字＋年2けた＋件数3けた */
export const CHUBAN_RE = /^[A-Z]{2}\d{5}$/;

/* ---------- 単価（いつから） ----------
   rates = { "2026-11-01": { kinds: {種類: 円…}, minus: "平日工場" }, … }
   その日の単価＝日付が row.d 以下の中で、いちばん新しいもの。なければはじめの単価 */
export function rateTable(rates) {
  const list = Object.entries(rates || {})
    .filter(([from]) => /^\d{4}-\d{2}-\d{2}$/.test(from))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([from, v]) => ({ from, kinds: fillKinds(v && v.kinds), minus: (v && v.minus) || DEFAULT_MINUS }));
  return list;
}
export function fillKinds(kinds) {
  const out = {};
  for (const k of KINDS) {
    const v = kinds && Number(kinds[k]);
    out[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_RATE;
  }
  return out;
}
const DEFAULT_SET = { from: "", kinds: fillKinds(null), minus: DEFAULT_MINUS };
/** 日付 d（YYYY-MM-DD）のときの単価の組 */
export function rateFor(table, d) {
  let hit = DEFAULT_SET;
  for (const r of table) {
    if (r.from <= String(d || "")) hit = r; else break;
  }
  return hit;
}

/* ---------- 日報の1行 ---------- */
/** 時間の合計 − 遅刻 − 早退（0より下にはしない） */
export const net = r => Math.max(0, KINDS.reduce((a, k) => a + num((r.h || {})[k]), 0) - num(r.late) - num(r.early));
/** 人工 */
export const ninku = r => WORK_KINDS.reduce((a, k) => a + num((r.h || {})[k]), 0) / 8;
/** 労務費（円） */
export function laborOf(r, rs) {
  const h = r.h || {};
  const plus = KINDS.reduce((a, k) => a + num(h[k]) * (rs.kinds[k] || 0), 0);
  const minus = (num(r.late) + num(r.early)) * (rs.kinds[rs.minus] || 0);
  return Math.max(0, Math.round(plus - minus));
}
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 作業者の会社の区分（日報の管理画面 kubunGroup と同じ）。名簿にいなければ、行の k を見る */
export function groupOf(name, workers, row) {
  const w = workers && workers.get(String(name || "").trim());
  if (w) {
    if (w.kubun === "自社") return "自社";
    if (w.kubun === "外注協力") return "外注協力";
    return "常駐協力";
  }
  const k = row && row.k;
  return k && k !== "自社" ? "常駐協力" : "自社";
}

/** 時間の種類 → 工場・現場（11/5 持ち主：持ち場だけで分けると、現場の日に工場の時間をつけた行が現場に入ってしまう）
 *  工場＝平日工場・工場残業・休日工場、現場＝平日現場・現場残業・休日現場。
 *  どちらでもない種類（移動行き・移動帰り・早出・深夜・突発）は、その行の持ち場（placeOf）で分ける */
export const PLACE_OF_KIND = { 平日工場: "工場", 工場残業: "工場", 休日工場: "工場", 平日現場: "現場", 現場残業: "現場", 休日現場: "現場" };

/** 日報の行の持ち場（kubun）→ 工場・現場・その他（種類で決まらない時間に使う）
 *  「工場」と名のつく所と北吉田（北吉田工場）→ 工場。空・その他・設計・事務所・倉庫番 → その他。のこり（現場・常駐など）→ 現場 */
export function placeOf(r) {
  const k = String((r && r.kubun) || "").trim();
  if (!k || k === "その他" || k === "設計" || k === "事務所" || k.includes("倉庫番")) return "その他";
  if (k.includes("工場") || k.includes("北吉田")) return "工場";
  return "現場";
}

/** 1行の労務費を 工場・現場・その他 に分ける。合計は laborOf(r, rs) と同じになる（遅刻・早退の分は、いちばん大きい所から引く） */
export function laborByPlace(r, rs) {
  const out = Object.fromEntries(PLACES.map(g => [g, 0]));
  const h = r.h || {};
  const fallback = placeOf(r);
  for (const k of KINDS) {
    const v = num(h[k]);
    if (v) out[PLACE_OF_KIND[k] || fallback] += v * (rs.kinds[k] || 0);
  }
  const want = laborOf(r, rs);
  const diff = PLACES.reduce((a, g) => a + out[g], 0) - want;
  if (diff) {
    const big = PLACES.reduce((a, g) => (out[g] > out[a] ? g : a), PLACES[0]);
    out[big] -= diff;
  }
  for (const g of PLACES) out[g] = Math.round(out[g]);
  return out;
}

/* ---------- お客さんに送る表（売り）の時間のまとめ方（11/6 持ち主：お客さんの常用の請求書と同じ分け方） ----------
   ふつう＝平日工場・平日現場（遅刻・早退を引く）、残業＝工場残業・現場残業、深夜、休日＝休日工場・休日現場、移動＝移動行き・帰り、早出、突発 */
export const URI_CATS = [
  ["ふつう", ["平日工場", "平日現場"]], ["残業", ["工場残業", "現場残業"]], ["深夜", ["深夜"]],
  ["休日", ["休日工場", "休日現場"]], ["移動", ["移動行き", "移動帰り"]], ["早出", ["早出"]], ["突発", ["突発"]],
];
export const DEFAULT_URI = { ふつう: 2500, 残業: 3125, 深夜: 3750, 休日: 2500, 移動: 2500, 早出: 2500, 突発: 2500 };
/** 行のならび → { ふつう: 時間, 残業: 時間, … }（ふつうから遅刻・早退を引く。0より下にはしない） */
export function uriHours(rows) {
  const out = Object.fromEntries(URI_CATS.map(([c]) => [c, 0]));
  for (const r of rows) {
    const h = r.h || {};
    for (const [c, kinds] of URI_CATS) for (const k of kinds) out[c] += num(h[k]);
    out["ふつう"] -= num(r.late) + num(r.early);
  }
  if (out["ふつう"] < 0) out["ふつう"] = 0;
  for (const c of Object.keys(out)) out[c] = Math.round(out[c] * 10) / 10;
  return out;
}
/** 売りの金額 = Σ 時間 × その区分の単価 */
export function uriYen(hours, rates) {
  return Math.round(URI_CATS.reduce((a, [c]) => a + (hours[c] || 0) * (Number((rates || {})[c]) || 0), 0));
}

/* ---------- 資材便の注文 ---------- */
/** 材料費（税抜）：請求書の金額、まだなら納品書の金額、どちらもなければ null（金額まだ） */
export const cost = o => (o.seikyu != null ? num(o.seikyu) : o.nouhin != null ? num(o.nouhin) : null);
/** 月に分けるときの日（設定 matDate：ordered＝注文した日・arrived＝届いた日・billed＝請求の日） */
export function orderDate(o, matDate = "ordered") {
  const t = matDate === "billed" ? (o.billedAt || o.arrivedAt || o.orderedAt)
    : matDate === "arrived" ? (o.arrivedAt || o.orderedAt)
    : o.orderedAt;
  return ymd(t);
}
/** ミリ秒 → YYYY-MM-DD（見ているパソコンの日付） */
export function ymd(t) {
  if (!t) return "";
  const d = new Date(Number(t));
  if (Number.isNaN(d.getTime())) return "";
  const p = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- 工事ごとにまとめる ----------
   rows … 日報の行（off の行はのぞいてから渡す）
   orders … 資材便の注文（取り消しはのぞいてから渡す）
   period … "all" か "YYYY-MM"
   opts … { workers: Map(名前→{kubun,shozoku}), rates: table, matDate } */
export const keyOf = r => (r.no ? String(r.no) : "free:" + String(r.j || ""));
/* ---------- 期間 ----------
   period … "all"（工事の全期間）・"YYYY-MM"（月）・"fy:YYYY"（決算期。YYYY＝その期がおわる年）
   決算月（11/5 持ち主：10月）。期＝前の年の11月〜その年の10月。例 fy:2026 ＝ 2025-11〜2026-10
   決算月は ⚙ 設定（settei.kessanMonth）に入れられるようにしてあるが、ルールに項目を足すまでは 10 のまま */
export const DEFAULT_KESSAN_MONTH = 10;
/** 日付 YYYY-MM… → その期がおわる年（決算月が10なら、11月以降は次の年の期） */
export function fiscalYearOf(d, km = DEFAULT_KESSAN_MONTH) {
  const y = Number(String(d).slice(0, 4)), m = Number(String(d).slice(5, 7));
  if (!y || !m) return 0;
  return m > km ? y + 1 : y;
}
/** 期の名前と、はじめ・おわりの月。fyLabel("fy:2026") → { label:"2026年10月期", from:"2025-11", to:"2026-10" } */
export function fyInfo(period, km = DEFAULT_KESSAN_MONTH) {
  const y = Number(String(period).replace("fy:", ""));
  const p = x => String(x).padStart(2, "0");
  const fromY = km === 12 ? y : y - 1, fromM = km === 12 ? 1 : km + 1;
  return { y, label: `${y}年${km}月期`, from: `${fromY}-${p(fromM)}`, to: `${y}-${p(km)}` };
}
/* ---------- 締め日の月（11/5 持ち主：お客さんへの請求に使う。例 20日締め → 10/21〜11/20 を「11月20日締め」） ----------
   period … "cut:20:2026-11"（締め日 20、2026-11-20 でおわるひと月） */
const pad2 = x => String(x).padStart(2, "0");
/** 日付 → その日が入る締めの月（YYYY-MM）。締め日より後の日は、次の月の締めに入る */
export function cutMonthOf(d, cutDay) {
  const y = Number(String(d).slice(0, 4)), m = Number(String(d).slice(5, 7)), day = Number(String(d).slice(8, 10));
  if (!y || !m || !day) return "";
  if (day <= cutDay) return `${y}-${pad2(m)}`;
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}
/** "cut:20:2026-11" → { cutDay, ym, from:"2026-10-21", to:"2026-11-20", label:"10/21〜11/20" } */
export function cutInfo(period) {
  const [, cd, ym] = String(period).split(":");
  const cutDay = Number(cd), y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const from = `${py}-${pad2(pm)}-${pad2(cutDay + 1)}`, to = `${y}-${pad2(m)}-${pad2(cutDay)}`;
  return { cutDay, ym, from, to, label: `${pm}/${cutDay + 1}〜${m}/${cutDay}` };
}
/** 記録のある締めの月（新しい順）["cut:20:2026-11", …] */
export function cutMonthsOf(rows, orders, matDate, cutDay) {
  const s = new Set();
  for (const r of rows) { const c = cutMonthOf(r.d, cutDay); if (c) s.add(c); }
  for (const o of orders) { const c = cutMonthOf(orderDate(o, matDate), cutDay); if (c) s.add(c); }
  return [...s].sort().reverse().map(c => `cut:${cutDay}:${c}`);
}

export const inPeriod = (d, period, km = DEFAULT_KESSAN_MONTH) => {
  if (period === "all") return true;
  const p = String(period);
  if (p.startsWith("fy:")) return fiscalYearOf(d, km) === Number(p.slice(3));
  if (p.startsWith("cut:")) { const [, cd, ym] = p.split(":"); return cutMonthOf(d, Number(cd)) === ym; }
  return String(d).slice(0, 7) === p;
};

export function jobStats(rows, orders, period, opts) {
  const km = opts.kessanMonth || DEFAULT_KESSAN_MONTH;
  const rs = rows.filter(r => inPeriod(r.d, period, km));
  const os = orders.filter(o => inPeriod(orderDate(o, opts.matDate), period, km));
  const lg = Object.fromEntries(GROUPS.map(g => [g, 0]));
  const lp = Object.fromEntries(PLACES.map(g => [g, 0]));
  let hours = 0, nk = 0;
  for (const r of rs) {
    const yen = laborOf(r, rateFor(opts.rates, r.d));
    lg[groupOf(r.n, opts.workers, r)] += yen;
    const byPlace = laborByPlace(r, rateFor(opts.rates, r.d));
    for (const g of PLACES) lp[g] += byPlace[g];
    hours += net(r);
    nk += ninku(r);
  }
  const labor = GROUPS.reduce((a, g) => a + lg[g], 0);
  const mat = os.reduce((a, o) => a + (cost(o) || 0), 0);
  const last = [...rs.map(r => String(r.d || "")), ...os.map(o => orderDate(o, opts.matDate))].filter(Boolean).sort().pop() || "";
  return {
    rows: rs, ords: os, lg, lp, labor, mat, total: labor + mat, hours, ninku: nk,
    noPrice: os.filter(o => cost(o) == null).length,
    mekki: os.filter(o => o.kind === "mekki").reduce((a, o) => a + (cost(o) || 0), 0),
    last,
  };
}

/** 注番 → お客さん（注番の頭2文字）。固定の注番（/common/kotei、例 MM000）が先 */
export function companyOf(no, kaisha, kotei) {
  if (!no) return { code: "", name: "注番なし" };
  const p = no.slice(0, 2);
  const kk = kotei && kotei[p + no.slice(4)];
  if (kk) return { code: "固定", name: "固定の注番（工場など）" };
  const k = kaisha && kaisha[p];
  return { code: p, name: (k && k.name) || `頭文字 ${p}（会社の表にない）` };
}

/** 固定の注番の割りあてのキー（OT26888 → "固定:OT888"。年がかわっても同じ） */
export const koteiKey = no => (no ? "固定:" + no.slice(0, 2) + no.slice(4) : "");

/** 固定の注番の名前（例 MM26000 → /common/kotei の MM000 の名前）。なければ "" */
export function koteiName(no, kotei) {
  if (!no || !kotei) return "";
  const k = kotei[no.slice(0, 2) + no.slice(4)];
  return k && k.name ? k.name : "";
}

/** 工事の一覧を作る（日報にある・注文がある工事ぜんぶ）
   jobs … Map(注番 → {name, owner, closed, fixed})（日報の master/jobs）
   返り値 [{key, no, name, owner, closed, free, comp, s}] */
/** freeMap … 注番なしの件名 → お客さんの名前（持ち主が「注番なし」の一覧でえらんだもの。11/5）。えらんだ分は、そのお客さんのカードに入る */
export function allJobs({ rows, orders, jobs, period, kaisha, kotei, workers, rates, matDate, kessanMonth, freeMap }) {
  const byKey = new Map();
  for (const r of rows) { const k = keyOf(r); (byKey.get(k) || byKey.set(k, { rows: [], ords: [] }).get(k)).rows.push(r); }
  for (const o of orders) { const k = String(o.chuban || ""); if (!k) continue; (byKey.get(k) || byKey.set(k, { rows: [], ords: [] }).get(k)).ords.push(o); }
  const out = [];
  for (const [key, v] of byKey) {
    const free = key.startsWith("free:");
    const no = free ? "" : key;
    const j = jobs && jobs.get(no);
    const s = jobStats(v.rows, v.ords, period, { workers, rates, matDate, kessanMonth });
    if (!s.rows.length && !s.ords.length) continue;
    const kn = koteiName(no, kotei);
    const name = free ? key.slice(5) : (j && j.name) || kn || (v.ords[0] && v.ords[0].kenmei) || (v.rows[0] && v.rows[0].j) || "（日報の注番にない）";
    let comp = companyOf(no, kaisha, kotei);
    // 注番なしは件名で、固定の注番は「固定:XX000」（年をのぞいた注番）で、持ち主が割りあてたお客さんを引く（11/6）
    const mapKey = free ? name : comp.code === "固定" ? koteiKey(no) : "";
    const mapped = mapKey && freeMap && freeMap[mapKey];
    if (mapped) comp = { code: "map", name: mapped };
    out.push({ key, no, name, owner: (j && j.owner) || "", closed: !!(j && j.closed), free, inNippo: !!j, comp, mapped: mapped || "", mapKey, s });
  }
  return out;
}

/** 合計 */
export function sumOf(list) {
  const t = { labor: 0, mat: 0, noPrice: 0, ninku: 0, hours: 0, lg: Object.fromEntries(GROUPS.map(g => [g, 0])), lp: Object.fromEntries(PLACES.map(g => [g, 0])) };
  for (const x of list) {
    t.labor += x.s.labor; t.mat += x.s.mat; t.noPrice += x.s.noPrice; t.ninku += x.s.ninku; t.hours += x.s.hours;
    for (const g of GROUPS) t.lg[g] += x.s.lg[g];
    for (const g of PLACES) t.lp[g] += x.s.lp[g];
  }
  return t;
}

/** 記録のある期（新しい順）["fy:2027","fy:2026"…] */
export function fiscalYearsOf(rows, orders, matDate, km = DEFAULT_KESSAN_MONTH) {
  const s = new Set();
  for (const r of rows) { const y = fiscalYearOf(r.d, km); if (y) s.add(y); }
  for (const o of orders) { const y = fiscalYearOf(orderDate(o, matDate), km); if (y) s.add(y); }
  return [...s].sort((a, b) => b - a).map(y => "fy:" + y);
}

/** 記録のある月（新しい順） */
export function monthsOf(rows, orders, matDate) {
  const s = new Set();
  for (const r of rows) { const m = String(r.d || "").slice(0, 7); if (m) s.add(m); }
  for (const o of orders) { const m = orderDate(o, matDate).slice(0, 7); if (m) s.add(m); }
  return [...s].sort().reverse();
}
