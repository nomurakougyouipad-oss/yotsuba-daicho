// よつば台帳（index.html）── 工事ごとの原価（1回目：労務費＝日報、材料費＝資材便）
// 登録していない → 台帳の合言葉＋このパソコンの名前 → 登録ずみの画面（最初の画面・工事の一覧・くわしく・⚙ 設定）
import { $, $$, esc, yen, hrs, nk, mdText, ymText, initTheme, initPanel, openPanel, closePanel, panelOpen, toast } from "./common.js";
import { whoAmI, register, errorText } from "./touroku.js";
import { watchConnected } from "./firebase.js";
import { watchNippo } from "./nippo.js";
import { watchOrders, watchCommon, watchDaicho } from "./zairyo.js";
import { KINDS, GROUPS, PLACES, DEFAULT_KESSAN_MONTH, fiscalYearOf, fyInfo, fiscalYearsOf, cutInfo, cutMonthsOf, URI_CATS, DEFAULT_URI, uriHours, uriYen, ymd, rateTable, rateFor, net, laborOf, groupOf, cost, orderDate, allJobs, sumOf, monthsOf, jobStats, companyOf, koteiName } from "./keisan.js";
import { openSettei } from "./settei.js";

initTheme();
initPanel();
const main = $("#main");
start();

async function start() {
  main.innerHTML = '<section class="card"><p class="muted">しらべています…</p></section>';
  let me;
  try {
    me = await whoAmI();
  } catch (ex) {
    main.innerHTML = `<section class="card"><h2>つながりません</h2><p class="err">${esc(errorText(ex))}</p>
      <button class="btn big" type="button" id="retry">もう一度</button></section>`;
    $("#retry").addEventListener("click", start);
    return;
  }
  if (me && me.role === "office") return showApp(me);
  showCode(me);
}

/* ---------- 台帳の合言葉と、このパソコンの名前を入れる ---------- */
function showCode(me) {
  $("#who").textContent = "工事ごとの原価";
  main.innerHTML = `
    <section class="card narrow-card">
      <h2>はじめての登録</h2>
      ${me && me.removed ? '<p class="warn">このパソコンの登録は消されています。もう一度登録してください。</p>' : ""}
      ${me && me.lost ? '<p class="warn">このパソコンに覚えていた登録が、消えていました。もう一度登録してください。</p>' : ""}
      ${me && me.zairyo ? '<p class="note"><b>このブラウザは資材便にも登録されています。</b>台帳は、資材便とは別のブラウザ（例：資材便＝Chrome、台帳＝Edge）で開く決まりです。別のブラウザで開きなおしてください。</p>' : ""}
      <p class="hint">台帳はお金の情報です。「台帳の合言葉」で登録したパソコンだけが見られます。合言葉は持ち主から口で聞いてください。</p>
      <form id="codeForm" class="form" novalidate>
        <div class="field">
          <label for="code">台帳の合言葉</label>
          <input id="code" class="inp" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="field">
          <label for="pcName">このパソコンの名前</label>
          <input id="pcName" class="inp" type="text" maxlength="20" autocomplete="off" placeholder="例：社長のノートパソコン">
          <p class="hint">登録した端末の一覧で、どのパソコンか分かるようにするためです。</p>
        </div>
        <p class="err" id="err" role="alert"></p>
        <button class="btn primary big full" type="submit" id="go">登録する</button>
      </form>
    </section>`;
  const go = $("#go"), err = $("#err");
  $("#codeForm").addEventListener("submit", async e => {
    e.preventDefault();
    const code = $("#code").value, name = $("#pcName").value.trim();
    if (!code.trim()) { err.textContent = "合言葉を入れてください"; return; }
    if (!name) { err.textContent = "このパソコンの名前を入れてください"; return; }
    go.disabled = true;
    go.textContent = "登録しています…";
    err.textContent = "";
    try {
      await register(code, name);
      start();
    } catch (ex) {
      err.textContent = errorText(ex);
      go.disabled = false;
      go.textContent = "登録する";
    }
  });
}

/* ---------- 登録ずみ：原価の画面 ---------- */
const D = { me: null, nippo: null, orders: null, ordersErr: "", common: null, daicho: null, connected: null };
// 期間："all"（工事の全期間）・"YYYY-MM"（月）・"fy:YYYY"（決算期）。最初の画面は今期から（11/5 持ち主）。工事のくわしい画面は全期間から
const KM = () => (D.daicho && D.daicho.settei && Number(D.daicho.settei.kessanMonth)) || DEFAULT_KESSAN_MONTH;
const thisFY = () => "fy:" + fiscalYearOf(ymd(Date.now()), KM());
let PERIOD = "fy:" + fiscalYearOf(ymd(Date.now()), DEFAULT_KESSAN_MONTH);
let compF = null, groupF = null, seg = "open", q = "";
let panelKey = null, panelMonth = "all";
// 締め日（お客さんへの請求用。このブラウザで覚える。はじめは20日）
let CUT = 20;
try { const v = Number(localStorage.getItem("daicho-cutday")); if (v >= 1 && v <= 28) CUT = v; } catch (err) { }
export const getCut = () => CUT;
export function setCut(v) { CUT = v; try { localStorage.setItem("daicho-cutday", String(v)); } catch (err) { } PERIOD = PERIOD.startsWith("cut:") ? thisFY() : PERIOD; panelMonth = "all"; renderAll(); }
// 注番なしの件名 → お客さん（このブラウザで覚える。次のルールの更新で /daicho/freeMap に移す）
let FREEMAP = {};
try { FREEMAP = JSON.parse(localStorage.getItem("daicho-freemap") || "{}") || {}; } catch (err) { FREEMAP = {}; }
function setFreeMap(name, to) {
  if (to) FREEMAP[name] = to; else delete FREEMAP[name];
  try { localStorage.setItem("daicho-freemap", JSON.stringify(FREEMAP)); } catch (err) { }
}
// お客さんに送る表の単価（売り。このブラウザで覚える。はじめは お客さんの常用の請求と同じ）
let URI = { ...DEFAULT_URI };
try { const v = JSON.parse(localStorage.getItem("daicho-uri") || "null"); if (v && typeof v === "object") URI = { ...DEFAULT_URI, ...v }; } catch (err) { }
export const getUri = () => ({ ...URI });
export function setUri(v) { URI = { ...DEFAULT_URI, ...v }; try { localStorage.setItem("daicho-uri", JSON.stringify(URI)); } catch (err) { } }
const cutText = p => { const i = cutInfo(p); return `${i.label}（${+i.ym.slice(5)}月${i.cutDay}日締め）`; };
// 労務費の箱の内わけ：会社の区分（group）か、工場・現場（place）か。切りかえたら覚える
let SPLIT = "group";
try { if (localStorage.getItem("daicho-split") === "place") SPLIT = "place"; } catch (err) { }

function showApp(me) {
  D.me = me;
  $("#who").textContent = `工事ごとの原価・${me.name}`;
  $("#period").hidden = false;
  $("#btnSettei").hidden = false;
  $("#btnSettei").addEventListener("click", () => { panelKey = null; openSettei(me, D); });
  main.innerHTML = `
    <div id="notes"></div>
    <section id="home">
      <div class="big3" id="homeBig"></div>
      <h2 class="sec-title" style="margin-top:16px">お客さん（注番の頭2文字）を選ぶ</h2>
      <div class="tiles" id="tiles"></div>
    </section>
    <section id="group" hidden>
      <div class="jhead"><h2 id="groupTitle"></h2><div class="sp"></div><button class="btn" id="groupXls" type="button">Excel に出す</button></div>
      <div class="big3" id="groupBig" style="margin-top:12px"></div>
      <h2 class="sec-title" style="margin-top:16px">区分を選ぶ</h2>
      <div class="tiles" id="groupTiles"></div>
    </section>
    <section id="jobs" hidden>
      <div class="jhead"><h2 id="jobsTitle"></h2><div class="sp"></div><button class="btn" id="jobsXls" type="button" hidden>Excel に出す</button></div>
      <div class="big3" id="jobsBig" style="margin-top:12px"></div>
      <div class="tools" style="margin-top:12px">
        <div class="seg" id="seg"></div><div class="sp"></div>
        <input type="search" id="q" placeholder="注番や件名でさがす" aria-label="注番や件名でさがす">
      </div>
      <div class="list" id="list" style="margin-top:12px"></div>
    </section>`;
  // もどるボタンは上の帯（スクロールしても見える。11/5 持ち主：スマホでボタンが流れてしまうため）
  $("#jobsXls").addEventListener("click", () => exportExcel(LIST.filter(x => x.comp.name === compF), compF));
  $("#groupXls").addEventListener("click", () => { const g = companyTiles(LIST).find(x => x.sub && x.c === groupF); if (g) exportExcel(g.items, g.c); });
  $("#topBack").addEventListener("click", () => {
    if (compF) { compF = null; show(groupF ? "group" : "home"); }
    else { groupF = null; show("home"); }
  });
  $("#q").addEventListener("input", e => { q = e.target.value; renderList(); });

  watchConnected(on => { D.connected = on; renderNotes(); });
  watchNippo(v => { D.nippo = v; renderAll(); }, err => { D.nippoErr = String((err && err.message) || err); renderNotes(); });
  watchOrders(v => { D.orders = v; D.ordersErr = ""; renderAll(); }, err => { D.orders = D.orders || []; D.ordersErr = /permission/i.test(String(err && err.message)) ? "perm" : String((err && err.message) || err); renderAll(); });
  watchCommon(v => { D.common = v; renderAll(); }, err => { D.common = D.common || { kaisha: {}, kotei: {} }; D.commonErr = /permission/i.test(String(err && err.message)) ? "perm" : String((err && err.message) || err); renderAll(); });
  watchDaicho(v => { D.daicho = v; renderAll(); }, err => { D.daicho = D.daicho || { rates: {}, settei: {} }; D.daichoErr = String((err && err.message) || err); renderAll(); });
  renderAll();
}

const ready = () => D.nippo && D.orders && D.common && D.daicho;
const opts = () => ({
  rows: D.nippo.rows, orders: D.orders, jobs: D.nippo.jobs, kaisha: D.common.kaisha, kotei: D.common.kotei,
  workers: D.nippo.workers, rates: rateTable(D.daicho.rates), matDate: (D.daicho.settei && D.daicho.settei.matDate) || "ordered",
  kessanMonth: KM(), freeMap: FREEMAP,
});
const fyName = p => (p === thisFY() ? "今期" : p === "fy:" + (fyInfo(thisFY(), KM()).y - 1) ? "前期" : fyInfo(p, KM()).label);
const periodText = () => { if (PERIOD === "all") return "工事の全期間"; if (PERIOD.startsWith("fy:")) { const i = fyInfo(PERIOD, KM()); return `${fyName(PERIOD)} ${ymText(i.from)}〜${ymText(i.to)}`; } if (PERIOD.startsWith("cut:")) return cutText(PERIOD); return `${ymText(PERIOD)}の分`; };

function renderNotes() {
  const el = $("#notes");
  if (!el) return;
  const n = [];
  if (D.connected === false) n.push('<div class="note bad"><b>Firebase につながっていません。</b>ネットをたしかめてください。つながると自動でもどります。</div>');
  if (D.nippoErr) n.push(`<div class="note bad"><b>日報が読めません。</b>${esc(D.nippoErr)}</div>`);
  if (!D.nippo) n.push('<div class="note">日報を読んでいます…</div>');
  if (D.ordersErr === "perm") n.push('<div class="note bad"><b>資材便を読む許可がまだです。</b>材料費が 0 のままになります。持ち主（Claude Code）が、ルールに「台帳の端末も読める」を足すと直ります（HANDOFF 4-1 の 4）。</div>');
  else if (D.ordersErr) n.push(`<div class="note bad"><b>資材便が読めません。</b>${esc(D.ordersErr)}</div>`);
  if (D.commonErr === "perm") n.push('<div class="note bad"><b>注番の会社の表（/common）を読む許可がまだです。</b>お客さんの名前が「頭文字 ○○」になります。</div>');
  if (D.daicho && !Object.keys(D.daicho.rates || {}).length) n.push('<div class="note">単価はまだ決めていないので、<b>全部 1時間 2,500円</b>（1工数 20,000円）で計算しています。⚙ 設定で変えられます。</div>');
  el.innerHTML = n.join("");
}

function renderPeriod() {
  const el = $("#period");
  const km = KM();
  const months = ready() ? monthsOf(D.nippo.rows, D.orders, opts().matDate) : [];
  const fys = ready() ? fiscalYearsOf(D.nippo.rows, D.orders, opts().matDate, km) : [];
  const cuts = ready() ? cutMonthsOf(D.nippo.rows, D.orders, opts().matDate, CUT) : [];
  const now = thisFY();
  if (!fys.includes(now)) fys.unshift(now);
  if (PERIOD !== "all" && !months.includes(PERIOD) && !fys.includes(PERIOD) && !cuts.includes(PERIOD)) PERIOD = now;
  const fyOpt = p => { const i = fyInfo(p, km); return `<option value="${p}" ${PERIOD === p ? "selected" : ""}>${fyName(p)}（${ymText(i.from)}〜${ymText(i.to)}）</option>`; };
  el.innerHTML = `<button class="tab ${PERIOD === now ? "on" : ""}" type="button" data-p="${now}">今期</button>
    <button class="tab ${PERIOD === "all" ? "on" : ""}" type="button" data-p="all">工事の全期間</button>
    <select id="pm" aria-label="期や月をえらぶ"><option value="">期・月をえらぶ…</option>
      <optgroup label="決算期（${km}月決算）">${fys.map(fyOpt).join("")}</optgroup>
      <optgroup label="月">${months.map(m => `<option value="${m}" ${PERIOD === m ? "selected" : ""}>${ymText(m)}</option>`).join("")}</optgroup>
      <optgroup label="${CUT}日締め（お客さんへの請求用。締め日は ⚙ 設定）">${cuts.map(c => `<option value="${c}" ${PERIOD === c ? "selected" : ""}>${cutText(c)}</option>`).join("")}</optgroup></select>`;
  $$("[data-p]", el).forEach(b => b.addEventListener("click", () => { PERIOD = b.dataset.p; renderAll(); }));
  $("#pm").addEventListener("change", e => { if (e.target.value) { PERIOD = e.target.value; renderAll(); } });
}

function big3(t, n) {
  const byPlace = SPLIT === "place";
  const keys = byPlace ? PLACES : GROUPS, vals = byPlace ? t.lp : t.lg;
  return `
  <div class="big labor"><div class="lab">労務費（日報から）<span class="segmini" role="group" aria-label="内わけの分け方"><button type="button" data-split="group" class="${byPlace ? "" : "on"}" aria-pressed="${!byPlace}">会社ごと</button><button type="button" data-split="place" class="${byPlace ? "on" : ""}" aria-pressed="${byPlace}">工場・現場</button></span></div><div class="val num">${yen(t.labor)}<small>円</small></div>
    <div class="split num">${keys.map(g => `<div><span class="l">${g}</span><b>${yen(vals[g])}<small>円</small></b></div>`).join("")}</div></div>
  <div class="big mat"><div class="lab">材料費（資材便から）</div><div class="val num">${yen(t.mat)}<small>円</small></div>
    <div class="split num"><div><span class="l">金額がまだの注文</span><b class="${t.noPrice ? "warn" : ""}">${t.noPrice}<small>件</small></b></div></div></div>
  <div class="big total"><div class="lab">原価の合計</div><div class="val num">${yen(t.labor + t.mat)}<small>円</small></div>
    <div class="split num"><div><span class="l">工事の数</span><b>${n}<small>件</small></b></div><div><span class="l">人工（にんく）</span><b>${nk(t.ninku)}<small>人工</small></b></div></div></div>`;
}

let LIST = [];
function renderAll() {
  renderNotes();
  if (!$("#home")) return;
  renderPeriod();
  if (!ready()) { $("#homeBig").innerHTML = ""; $("#tiles").innerHTML = '<div class="empty">読んでいます…</div>'; return; }
  LIST = allJobs({ ...opts(), period: PERIOD });
  if (compF) renderJobs(); else if (groupF) renderGroup(); else renderHome();
  if (panelKey && panelOpen()) openJob(panelKey);
}

function wireSplit(el) {
  $$("[data-split]", el).forEach(b => b.addEventListener("click", () => {
    if (SPLIT === b.dataset.split) return;
    SPLIT = b.dataset.split;
    try { localStorage.setItem("daicho-split", SPLIT); } catch (err) { }
    renderAll();
  }));
}

/** 画面を切りかえる（home＝お客さん一覧、group＝まとめの中、jobs＝工事の一覧） */
function show(which) {
  for (const id of ["home", "group", "jobs"]) $("#" + id).hidden = id !== which;
  const back = $("#topBack");
  back.hidden = which === "home";
  back.textContent = which === "jobs" && groupF ? `← ${groupF}` : "← お客さん一覧";
  renderAll();
  scrollTo({ top: 0 });
}

/* ---------- お客さんのまとめ ----------
   名前の最初の5文字が同じお客さんが2つ以上あれば、1つのカードにまとめる（例：「見本ポンプ保全」「見本ポンプ施設」→「見本ポンプ」）。
   まとめの名前＝その5文字。固定の注番・注番なしはまとめない。11/5 持ち主（ためし） */
const GROUP_LEN = 5;
function groupKey(g) {
  if (g.code === "map") return String(g.c || "");   // 注番なしから割りあてた分：同じ名前のまとめ（か会社）に入る
  if (!g.code || g.code === "固定") return "";
  const n = [...String(g.c || "")];
  return n.length > GROUP_LEN ? n.slice(0, GROUP_LEN).join("") : "";
}
/** お客さんごとにまとめたもの [{c, code, items, t, sub:[…] | null}] */
function companyTiles(list) {
  const comps = {};
  for (const x of list) { const c = x.comp.name; const g = comps[c] = comps[c] || { c, code: x.comp.code, items: [] }; g.items.push(x); if (g.code === "map" && x.comp.code !== "map") g.code = x.comp.code; }
  const byKey = {};
  for (const g of Object.values(comps)) { const k = groupKey(g); (byKey[k || "\u0000" + g.c] = byKey[k || "\u0000" + g.c] || []).push(g); }
  const out = [];
  for (const [k, gs] of Object.entries(byKey)) {
    if (!k.startsWith("\u0000") && gs.length >= 2 && gs.some(g => g.code !== "map")) {
      const items = gs.flatMap(g => g.items);
      out.push({ c: k, code: "", items, sub: gs.map(g => ({ ...g, t: sumOf(g.items) })).sort((a, b) => (b.t.labor + b.t.mat) - (a.t.labor + a.t.mat)) });
    } else {
      for (const g of gs) out.push({ ...g, sub: null });
    }
  }
  return out.map(g => ({ ...g, t: sumOf(g.items) })).sort((a, b) => (b.t.labor + b.t.mat) - (a.t.labor + a.t.mat));
}
function tileHTML(g, attr) {
  return `<button class="tile ${g.items.every(x => x.closed) ? "idle" : ""}" type="button" ${attr}>
    <div class="tname">${esc(g.c)}${g.code && g.code !== "固定" && g.code !== "map" ? `<span class="code">${esc(g.code)}</span>` : ""}${g.sub ? `<span class="code">${g.sub.length}つの区分</span>` : ""}</div>
    <div class="trows"><div><span class="lab">工事</span><b class="num">${g.items.length}</b></div>
      <div><span class="lab">労務費＋材料費</span><b class="num tot">${yen(g.t.labor + g.t.mat)}</b></div>
      <div><span class="lab">金額まだの注文</span><b class="num">${g.t.noPrice || "–"}</b></div></div></button>`;
}
function gotoJobs(c) { compF = c; seg = "open"; q = ""; $("#q").value = ""; show("jobs"); }

function renderHome() {
  $("#homeBig").innerHTML = big3(sumOf(LIST), LIST.length);
  wireSplit($("#homeBig"));
  const arr = companyTiles(LIST);
  $("#tiles").innerHTML = arr.map(g => tileHTML(g, g.sub ? `data-g="${esc(g.c)}"` : `data-c="${esc(g.c)}"`)).join("")
    || `<div class="empty">${esc(periodText())}の記録はありません</div>`;
  $$("#tiles .tile").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.g) { groupF = b.dataset.g; show("group"); } else gotoJobs(b.dataset.c);
  }));
}

function renderGroup() {
  const g = companyTiles(LIST).find(x => x.sub && x.c === groupF);
  if (!g) { groupF = null; show("home"); return; }
  $("#groupTitle").textContent = `${g.c}（${periodText()}）`;
  $("#groupBig").innerHTML = big3(g.t, g.items.length);
  wireSplit($("#groupBig"));
  $("#groupTiles").innerHTML = g.sub.map(x => tileHTML(x, `data-c="${esc(x.c)}"`)).join("");
  $$("#groupTiles .tile").forEach(b => b.addEventListener("click", () => gotoJobs(b.dataset.c)));
}

function renderJobs() {
  const all = LIST.filter(x => x.comp.name === compF);
  $("#jobsTitle").textContent = `${compF}（${periodText()}）`;
  $("#jobsXls").hidden = false;
  $("#jobsBig").innerHTML = big3(sumOf(all), all.length);
  wireSplit($("#jobsBig"));
  const c = { open: all.filter(x => !x.closed).length, closed: all.filter(x => x.closed).length, all: all.length };
  if (seg === "open" && !c.open && c.closed) seg = "all";
  $("#seg").innerHTML = [["open", "動いている", c.open], ["closed", "おわった", c.closed], ["all", "すべて", c.all]]
    .map(([k, l, n]) => `<button class="tab ${seg === k ? "on" : ""}" type="button" data-k="${k}">${l} <small>${n}</small></button>`).join("");
  $$("#seg .tab").forEach(b => b.addEventListener("click", () => { seg = b.dataset.k; renderJobs(); }));
  renderList();
}

/** 注番なしの件名を割りあてられる先（お客さんのまとめ・会社の名前） */
function mapTargets() {
  const names = new Set();
  for (const x of LIST) if (!x.free && x.comp.code && x.comp.code !== "固定") names.add(x.comp.name);
  for (const g of companyTiles(LIST)) if (g.sub) names.add(g.c);
  for (const v of Object.values(FREEMAP)) names.add(v);
  return [...names].sort((a, b) => a.localeCompare(b, "ja"));
}
function renderList() {
  const all = LIST.filter(x => x.comp.name === compF);
  const isFree = compF === "注番なし";
  const targets = isFree ? mapTargets() : [];
  const qq = q.trim().toLowerCase();
  const rows = all.filter(x => seg === "all" || (seg === "closed" ? x.closed : !x.closed))
    .filter(x => !qq || (x.no + x.name + x.owner).toLowerCase().includes(qq))
    .sort((a, b) => b.s.total - a.s.total);
  $("#list").innerHTML = rows.map(x => `<button class="job ${x.closed ? "closed" : ""} ${x.free ? "free" : ""}" type="button" data-k="${esc(x.key)}">
    <div class="jname"><h3>${esc(x.name)}</h3><div class="meta">${x.no ? `<span>注番 <b>${esc(x.no)}</b></span>` : '<span class="chip free">注番なし</span>'}${x.mapped ? `<span class="chip">${esc(x.mapped)}の分</span>` : ""}${x.owner ? `<span>担当 ${esc(x.owner)}</span>` : ""}${x.closed ? '<span class="chip end">おわった</span>' : ""}${!x.free && !x.inNippo ? '<span class="chip free">日報の注番にない</span>' : ""}<span>最後 ${esc(mdText(x.s.last))}</span></div>
      ${isFree ? `<label class="mapsel" onclick="event.stopPropagation()">どのお客さんの分？ <select data-map="${esc(x.name)}"><option value="">—</option>${targets.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select></label>` : ""}</div>
    <div class="cell c-nk"><div class="lab">人工</div><div class="v num">${nk(x.s.ninku)}</div></div>
    <div class="cell c-labor"><div class="lab">労務費</div><div class="v num">${yen(x.s.labor)}<small>円</small></div>${x.s.lp["その他"] ? `<div class="sub">うち その他 ${yen(x.s.lp["その他"])}円</div>` : ""}</div>
    <div class="cell c-kojo"><div class="lab">うち 工場</div><div class="v num dim">${yen(x.s.lp["工場"])}<small>円</small></div></div>
    <div class="cell c-genba"><div class="lab">うち 現場</div><div class="v num dim">${yen(x.s.lp["現場"])}<small>円</small></div></div>
    <div class="cell c-mat"><div class="lab">材料費</div><div class="v num">${yen(x.s.mat)}<small>円</small></div>${x.s.noPrice ? `<div class="sub warn">金額まだ ${x.s.noPrice}件</div>` : ""}</div>
    <div class="cell c-total"><div class="lab">原価の合計</div><div class="v num tot">${yen(x.s.total)}<small>円</small></div></div></button>`).join("")
    || '<div class="empty">この条件の工事はありません</div>';
  $$("#list .job").forEach(b => b.addEventListener("click", e => { if (e.target.closest(".mapsel")) return; panelMonth = "all"; openJob(b.dataset.k); }));
  $$("#list [data-map]").forEach(sel => sel.addEventListener("change", () => {
    setFreeMap(sel.dataset.map, sel.value);
    toast(sel.value ? `「${sel.dataset.map}」を ${sel.value} の分にしました` : "もどしました");
    renderAll();
  }));
}

/* ---------- 工事の原価（くわしく） ---------- */
function openJob(key) {
  panelKey = key;
  const o = opts();
  const free = key.startsWith("free:"), no = free ? "" : key;
  const rowsAll = o.rows.filter(r => (r.no ? r.no : "free:" + (r.j || "")) === key);
  const ordsAll = o.orders.filter(x => x.chuban === key);
  const ms = monthsOf(rowsAll, ordsAll, o.matDate).sort();
  const cs = cutMonthsOf(rowsAll, ordsAll, o.matDate, CUT).sort();
  if (panelMonth !== "all" && !ms.includes(panelMonth) && !cs.includes(panelMonth)) panelMonth = "all";
  const s = jobStats(rowsAll, ordsAll, panelMonth, o);
  const j = o.jobs.get(no);
  const name = free ? key.slice(5) : (j && j.name) || koteiName(no, o.kotei) || (ordsAll[0] && ordsAll[0].kenmei) || "（日報の注番にない）";
  const comp = companyOf(no, o.kaisha, o.kotei);
  const kindSum = {}, per = {};
  let lateH = 0, minusYen = 0;
  for (const r of s.rows) {
    const rs = rateFor(o.rates, r.d);
    for (const k of KINDS) { const v = Number((r.h || {})[k]) || 0; if (v) { kindSum[k] = kindSum[k] || { h: 0, yen: 0 }; kindSum[k].h += v; kindSum[k].yen += v * rs.kinds[k]; } }
    const m = (Number(r.late) || 0) + (Number(r.early) || 0);
    lateH += m; minusYen += m * (rs.kinds[rs.minus] || 0);
    const p = per[r.n] = per[r.n] || { n: r.n, g: groupOf(r.n, o.workers, r), h: 0, yen: 0, days: new Set() };
    p.h += net(r); p.yen += laborOf(r, rs); p.days.add(r.d);
  }
  const stTx = { wait: "待ち（届いていない）", arrived: "届いた（請求まだ）", billed: "請求ずみ" };
  const GCOL = { 自社: "var(--bar)", 常駐協力: "var(--bar2)", 外注協力: "var(--bar3)" };
  const PCOL = { 工場: "var(--bar)", 現場: "var(--bar2)", その他: "var(--bar3)" };
  const ords = [...s.ords].sort((a, b) => (a.orderedAt || 0) - (b.orderedAt || 0));
  openPanel(`
   <div class="p-head"><div class="row"><span class="num muted">${esc(no || "注番なし")}</span><span class="muted" style="font-size:14px">${esc(comp.name)}</span><div class="sp"></div><button class="btn" type="button" data-close>✕ とじる</button></div>
     <h2>${esc(name)}</h2>
     <div class="months"><button type="button" data-m="all" class="${panelMonth === "all" ? "on" : ""}">工事の全期間</button>${ms.map(m => `<button type="button" data-m="${m}" class="${panelMonth === m ? "on" : ""}">${ymText(m)}</button>`).join("")}</div>
     <div class="months cutrow"><span class="hint">${CUT}日締め</span>${cs.map(c => `<button type="button" data-m="${c}" class="${panelMonth === c ? "on" : ""}">${cutInfo(c).label}</button>`).join("")}</div></div>
   <div class="p-body">
    <div class="sec"><div class="big3">
      <div class="big labor"><div class="lab">労務費</div><div class="val num" style="font-size:26px">${yen(s.labor)}<small>円</small></div><div class="lab">${nk(s.ninku)} 人工・${hrs(s.hours)} 時間</div></div>
      <div class="big mat"><div class="lab">材料費</div><div class="val num" style="font-size:26px">${yen(s.mat)}<small>円</small></div><div class="lab ${s.noPrice ? "warn" : ""}">${s.noPrice ? `金額まだ ${s.noPrice}件` : "金額まだ なし"}</div></div>
      <div class="big total"><div class="lab">原価の合計</div><div class="val num" style="font-size:26px">${yen(s.total)}<small>円</small></div><div class="lab">${panelMonth === "all" ? "工事の全期間" : panelMonth.startsWith("cut:") ? cutText(panelMonth) : ymText(panelMonth) + "の分"}</div></div>
    </div></div>
    <div class="sec"><h4>労務費の内わけ <span class="hint">会社の区分ごと</span></h4>
      <div class="stack">${GROUPS.map(g => `<i style="width:${s.labor ? s.lg[g] / s.labor * 100 : 0}%;background:${GCOL[g]}"></i>`).join("")}</div>
      <div class="legend">${GROUPS.map(g => `<span style="--c:${GCOL[g]}">${g} ${yen(s.lg[g])}円</span>`).join("")}</div></div>
    <div class="sec"><h4>労務費の内わけ <span class="hint">工場（製作）・現場（時間の種類で分ける。移動・早出・深夜・突発は持ち場で）</span></h4>
      <div class="stack">${PLACES.map(g => `<i style="width:${s.labor ? s.lp[g] / s.labor * 100 : 0}%;background:${PCOL[g]}"></i>`).join("")}</div>
      <div class="legend">${PLACES.map(g => `<span style="--c:${PCOL[g]}">${g} ${yen(s.lp[g])}円</span>`).join("")}</div></div>
    <div class="sec"><h4>時間の種類ごと <span class="hint">単価は ⚙ 設定 で変えられます（いつからも残ります）</span></h4>
      <table><thead><tr><th>種類</th><th class="r">時間</th><th class="r">金額</th></tr></thead><tbody>
      ${KINDS.filter(k => kindSum[k]).map(k => `<tr><td>${k}</td><td class="r num">${hrs(kindSum[k].h)}h</td><td class="r num">${yen(kindSum[k].yen)}円</td></tr>`).join("")}
      ${lateH ? `<tr><td>遅刻・早退（引く）</td><td class="r num">−${hrs(lateH)}h</td><td class="r num">−${yen(minusYen)}円</td></tr>` : ""}
      <tr class="sum"><td>合計</td><td class="r num">${hrs(s.hours)}h</td><td class="r num">${yen(s.labor)}円</td></tr></tbody></table></div>
    <div class="sec"><h4>人ごと</h4><table><thead><tr><th>名前</th><th>区分</th><th class="r">日数</th><th class="r">時間</th><th class="r">労務費</th></tr></thead><tbody>
      ${Object.values(per).sort((a, b) => b.yen - a.yen).map(p => `<tr><td>${esc(p.n)}</td><td class="muted">${p.g}</td><td class="r num">${p.days.size}</td><td class="r num">${hrs(p.h)}h</td><td class="r num">${yen(p.yen)}円</td></tr>`).join("") || '<tr><td colspan="5" class="muted">日報はまだありません</td></tr>'}</tbody></table></div>
    <div class="sec"><h4>材料（資材便の注文）<span class="hint">材料費＝請求書の金額、まだなら納品書の金額（税抜）</span></h4><table><thead><tr><th>材料屋</th><th>日</th><th>ようす</th><th class="r">金額</th></tr></thead><tbody>
      ${ords.map(x => `<tr><td>${esc(x.supplierName || x.supplier || "")}${x.kind === "mekki" ? ' <span class="chip">めっき</span>' : x.kind === "kakou" ? ' <span class="chip">加工品</span>' : ""}</td><td class="num muted">${esc(mdText(orderDate(x, o.matDate)))}</td><td class="st ${esc(x.status || "")}">${stTx[x.status] || esc(x.status || "")}</td><td class="r num">${cost(x) == null ? '<span class="warn">まだ</span>' : yen(cost(x)) + "円"}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">注文はありません</td></tr>'}
      ${ords.length ? `<tr class="sum"><td colspan="2">合計</td><td>${s.mekki ? `うち めっき ${yen(s.mekki)}円` : ""}</td><td class="r num">${yen(s.mat)}円</td></tr>` : ""}</tbody></table></div>
   </div>`, p => {
    $$("[data-m]", p).forEach(b => b.addEventListener("click", () => { panelMonth = b.dataset.m; openJob(key); }));
  });
}

/* ---------- Excel に出す（請求の明細の下じらべ用。11/5 持ち主）----------
   1枚目「工事ごと」：注番・件名・お客さん・人工・時間の種類ごとの時間・遅刻早退・労務費・材料費
   2枚目「日ごと」：日付・名前・区分・注番・件名・持ち場・時間の種類ごとの時間・遅刻・早退（先方に聞かれたときの裏づけ）
   3枚目「材料」：資材便の注文（注番・材料屋・日・ようす・金額）
   いま見ている期間（今期・月・締めの月…）の分だけ */
function exportExcel(list, title) {
  const X = window.XLSX;
  if (!X) { toast("Excel の部品がまだ読みこめていません。少し待ってもう一度"); return; }
  const o = opts();
  const head1 = ["注番", "件名", "お客さん", "担当", "人工", "時間の合計", ...KINDS, "遅刻", "早退", "労務費", "うち工場", "うち現場", "うちその他", "材料費", "金額まだの注文"];
  const rows1 = [], rows2 = [], rows3 = [];
  for (const x of [...list].sort((a, b) => (a.no || "~").localeCompare(b.no || "~"))) {
    const s = x.s, ks = Object.fromEntries(KINDS.map(k => [k, 0]));
    let late = 0, early = 0;
    for (const r of s.rows) {
      for (const k of KINDS) ks[k] += Number((r.h || {})[k]) || 0;
      late += Number(r.late) || 0; early += Number(r.early) || 0;
      rows2.push([r.d, r.n, groupOf(r.n, o.workers, r), x.no, x.name, r.kubun || "", ...KINDS.map(k => Number((r.h || {})[k]) || 0), Number(r.late) || 0, Number(r.early) || 0, net(r)]);
    }
    rows1.push([x.no, x.name, x.comp.name, x.owner, Math.round(s.ninku * 100) / 100, Math.round(s.hours * 10) / 10, ...KINDS.map(k => Math.round(ks[k] * 10) / 10), late, early, s.labor, s.lp["工場"], s.lp["現場"], s.lp["その他"], s.mat, s.noPrice]);
    for (const od of [...s.ords].sort((a, b) => (a.orderedAt || 0) - (b.orderedAt || 0))) {
      rows3.push([x.no, x.name, od.supplierName || od.supplier || "", orderDate(od, o.matDate), { wait: "待ち", arrived: "届いた", billed: "請求ずみ" }[od.status] || od.status || "", od.kind === "mekki" ? "めっき" : od.kind === "kakou" ? "加工品" : "", cost(od) == null ? "まだ" : cost(od)]);
    }
  }
  rows2.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1], "ja"));
  const t = sumOf(list);
  rows1.push([]);
  rows1.push(["合計", "", "", "", Math.round(t.ninku * 100) / 100, Math.round(t.hours * 10) / 10, ...KINDS.map(() => ""), "", "", t.labor, t.lp["工場"], t.lp["現場"], t.lp["その他"], t.mat, t.noPrice]);
  // 送る用：工事名称・区分ごとの時間・金額（売りの単価。⚙ 設定）
  const cats = URI_CATS.map(([c]) => c);
  const rows0 = [];
  const tot0 = Object.fromEntries(cats.map(c => [c, 0]));
  let totYen = 0;
  for (const x of [...list].sort((a, b) => b.s.labor - a.s.labor)) {
    const h = uriHours(x.s.rows);
    if (!cats.some(c => h[c])) continue;
    const y = uriYen(h, URI);
    rows0.push([x.name, x.no, ...cats.map(c => h[c] || ""), y]);
    for (const c of cats) tot0[c] += h[c];
    totYen += y;
  }
  rows0.push([]);
  rows0.push(["合計", "", ...cats.map(c => Math.round(tot0[c] * 10) / 10), totYen]);
  rows0.push([]);
  rows0.push(["単価（1時間）", "", ...cats.map(c => URI[c]), ""]);
  const wb = X.utils.book_new();
  const note = [[`よつば台帳 ${title}`, periodText(), `出した日 ${ymd(Date.now())}`], []];
  const ws0 = X.utils.aoa_to_sheet([...note, ["工事名称", "注番", ...cats.map(c => c + "（時間）"), "金額（税抜）"], ...rows0]);
  ws0["!cols"] = [{ wch: 36 }, { wch: 10 }, ...cats.map(() => ({ wch: 9 })), { wch: 13 }];
  X.utils.book_append_sheet(wb, ws0, "送る用");
  const ws1 = X.utils.aoa_to_sheet([...note, head1, ...rows1]);
  const ws2 = X.utils.aoa_to_sheet([...note, ["日付", "名前", "区分", "注番", "件名", "持ち場", ...KINDS, "遅刻", "早退", "実働"], ...rows2]);
  const ws3 = X.utils.aoa_to_sheet([...note, ["注番", "件名", "材料屋", "日", "ようす", "種類", "金額（税抜）"], ...rows3]);
  ws1["!cols"] = [{ wch: 10 }, { wch: 36 }, { wch: 18 }, { wch: 8 }, { wch: 7 }, { wch: 9 }, ...KINDS.map(() => ({ wch: 8 })), { wch: 6 }, { wch: 6 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 8 }];
  ws2["!cols"] = [{ wch: 11 }, { wch: 10 }, { wch: 9 }, { wch: 10 }, { wch: 36 }, { wch: 10 }, ...KINDS.map(() => ({ wch: 8 })), { wch: 6 }, { wch: 6 }, { wch: 7 }];
  ws3["!cols"] = [{ wch: 10 }, { wch: 36 }, { wch: 18 }, { wch: 11 }, { wch: 9 }, { wch: 7 }, { wch: 12 }];
  X.utils.book_append_sheet(wb, ws1, "工事ごと");
  X.utils.book_append_sheet(wb, ws2, "日ごと");
  X.utils.book_append_sheet(wb, ws3, "材料");
  const safe = s => String(s).replace(/[\\/:*?"<>|]/g, "_");
  X.writeFile(wb, `台帳_${safe(title)}_${safe(periodText())}.xlsx`);
  toast("Excel を保存しました");
}
