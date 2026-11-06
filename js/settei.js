// ⚙ 設定（単価・材料費を月に分ける日・登録した端末・合言葉を変える・今すぐ保存）
// 台帳は自分の所（/daicho/…）にだけ書く。日報・資材便には書かない
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { db, call } from "./firebase.js";
import { $, $$, esc, yen, openPanel, closePanel, toast } from "./common.js";
import { myUid, errorText } from "./touroku.js";
import { KINDS, DEFAULT_RATE, DEFAULT_MINUS, URI_CATS, rateTable, fillKinds } from "./keisan.js";
import { getCut, setCut, getUri, setUri } from "./app.js";

let tab = "rate";

export function openSettei(me, D) {
  openPanel(`
    <div class="p-head"><div class="row"><h2>⚙ 設定</h2><div class="sp"></div><button class="btn" type="button" data-close>✕ とじる</button></div>
      <div class="set-tabs" id="setTabs">
        <button type="button" data-t="rate">単価</button>
        <button type="button" data-t="dev">登録した端末</button>
        <button type="button" data-t="code">合言葉</button>
        <button type="button" data-t="save">今すぐ保存</button>
      </div></div>
    <div class="p-body" id="setBody"></div>`, p => {
    $$("#setTabs button", p).forEach(b => b.addEventListener("click", () => { tab = b.dataset.t; paint(me, D); }));
    paint(me, D);
  });
}

function paint(me, D) {
  $$("#setTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  const body = $("#setBody");
  if (tab === "rate") return paintRate(body, me, D);
  if (tab === "dev") return paintDevices(body, me);
  if (tab === "code") return paintCode(body);
  if (tab === "save") return paintSave(body, me);
}

/* ---------- 単価（いつから） ---------- */
const today = () => { const d = new Date(), p = x => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const jp = d => (d ? `${+d.slice(0, 4)}年${+d.slice(5, 7)}月${+d.slice(8)}日` : "");

function paintRate(body, me, D) {
  const table = rateTable(D.daicho && D.daicho.rates);
  const latest = table.length ? table[table.length - 1] : { from: "", kinds: fillKinds(null), minus: DEFAULT_MINUS };
  const matDate = (D.daicho && D.daicho.settei && D.daicho.settei.matDate) || "ordered";
  body.innerHTML = `
    <div class="sec"><h4>いまの単価（1時間）</h4>
      ${table.length ? `<div class="ratehist">${[...table].reverse().map(r => `<div class="rh"><b>${esc(jp(r.from))}から</b><span class="muted">${KINDS.filter(k => r.kinds[k] !== DEFAULT_RATE).map(k => `${k} ${yen(r.kinds[k])}円`).join("・") || "全部 " + yen(DEFAULT_RATE) + "円"}</span>${r.minus !== DEFAULT_MINUS ? `<span class="muted">遅刻・早退は${esc(r.minus)}の単価で引く</span>` : ""}</div>`).join("")}</div>`
        : `<p class="muted">まだ決めていないので、全部 <b class="num">${yen(DEFAULT_RATE)}</b>円（1工数 20,000円）で計算しています。</p>`}
    </div>
    <div class="sec"><h4>単価を変える <span class="hint">「いつから」の日より前の月の労務費は、前の単価のまま変わりません</span></h4>
      <form id="rateForm" class="form" novalidate>
        <div class="field"><label for="rFrom">いつから</label><input id="rFrom" class="inp" type="date" value="${today()}" style="max-width:220px"></div>
        <div class="rates">${KINDS.map(k => `<label for="r_${k}">${k}</label><input class="inp num" id="r_${k}" data-k="${k}" inputmode="numeric" value="${latest.kinds[k]}">`).join("")}</div>
        <div class="field"><label for="rMinus">遅刻・早退を引くときの単価</label>
          <select id="rMinus">${["平日工場", "平日現場"].map(k => `<option value="${k}" ${latest.minus === k ? "selected" : ""}>${k}の単価で引く</option>`).join("")}</select></div>
        <p class="err" id="rErr" role="alert"></p>
        <button class="btn primary big" type="submit" id="rGo">この単価を保存する</button>
      </form></div>
    <div class="sec"><h4>材料費を「月ごと」に分けるときの日</h4>
      <div class="radios" id="matRadios">
        ${[["ordered", "注文した日"], ["arrived", "届いた日（まだなら注文した日）"], ["billed", "請求の日（まだなら届いた日・注文した日）"]].map(([v, l]) => `<label><input type="radio" name="matDate" value="${v}" ${matDate === v ? "checked" : ""}>${l}</label>`).join("")}
      </div>
      <p class="hint">「工事の全期間」には関係ありません。月をえらんだときだけ、どの月に入れるかが変わります。</p></div>
    <div class="sec"><h4>締め日（お客さんへの請求用の区切り）</h4>
      <div class="field"><select id="cutSel" style="max-width:220px">${[5, 10, 15, 20, 25].map(d => `<option value="${d}" ${getCut() === d ? "selected" : ""}>${d}日締め（前の月の${d + 1}日〜${d}日）</option>`).join("")}</select></div>
      <p class="hint">上の「期・月をえらぶ」と、工事のくわしい画面に「${getCut()}日締め」の月が出ます。このパソコンだけの設定です（ほかのパソコンは別々に決めます）。</p></div>
    <div class="sec"><h4>お客さんに送る表の単価（売り） <span class="hint">「Excel に出す」の「送る用」の金額に使います。上の労務費（原価）の単価とは別です</span></h4>
      <div class="rates" id="uriRates">${URI_CATS.map(([c, kinds]) => `<label for="u_${c}">${c} <span class="hint">${kinds.join("・")}</span></label><input class="inp num" id="u_${c}" data-u="${c}" inputmode="numeric" value="${getUri()[c]}">`).join("")}</div>
      <p class="hint">入れたらすぐ覚えます（このパソコンだけ）。ふつうは遅刻・早退を引いた時間です。</p></div>`;
  $("#rateForm").addEventListener("submit", async e => {
    e.preventDefault();
    const from = $("#rFrom").value, err = $("#rErr"), go = $("#rGo");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) { err.textContent = "いつからの日を入れてください"; return; }
    const kinds = {};
    for (const i of $$("#rateForm [data-k]")) {
      const v = Number(String(i.value).replace(/[^\d]/g, ""));
      if (!Number.isFinite(v) || v < 0 || v >= 1000000) { err.textContent = `${i.dataset.k}の単価がおかしいです`; i.focus(); return; }
      kinds[i.dataset.k] = v;
    }
    go.disabled = true; err.textContent = "";
    try {
      await set(ref(db, `daicho/rates/${from}`), { kinds, minus: $("#rMinus").value, setAt: Date.now(), setBy: me.name || "" });
      toast(`${jp(from)}からの単価を保存しました`);
    } catch (ex) { err.textContent = errorText(ex); }
    go.disabled = false;
  });
  $$("#uriRates [data-u]").forEach(i => i.addEventListener("change", () => {
    const v = { ...getUri() };
    for (const el of $$("#uriRates [data-u]")) { const n = Number(String(el.value).replace(/[^\d]/g, "")); v[el.dataset.u] = Number.isFinite(n) ? n : 0; }
    setUri(v); toast("送る表の単価を覚えました");
  }));
  $("#cutSel").addEventListener("change", e => { setCut(Number(e.target.value)); toast(`${e.target.value}日締めにしました`); paintRate(body, me, D); });
  $$("#matRadios input").forEach(i => i.addEventListener("change", async () => {
    try { await update(ref(db, "daicho/settei"), { matDate: i.value }); toast("月に分ける日を変えました"); }
    catch (ex) { toast(errorText(ex)); }
  }));
}

/* ---------- 登録した端末 ---------- */
const when = t => (t ? new Date(t).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }) : "—");
async function paintDevices(body, me) {
  body.innerHTML = '<p class="muted">読んでいます…</p>';
  let v;
  try { v = (await get(ref(db, "daicho/devices"))).val() || {}; } catch (ex) { body.innerHTML = `<p class="err">${esc(errorText(ex))}</p>`; return; }
  const list = Object.entries(v).sort((a, b) => (b[1].seenAt || 0) - (a[1].seenAt || 0));
  body.innerHTML = `
    <div class="sec"><h4>台帳を見られるパソコン <span class="hint">${list.length}台</span></h4>
      <div>${list.map(([uid, d]) => `<div class="dev"><div><div class="n">${esc(d.name || "")}${uid === myUid() ? ' <span class="chip">このパソコン</span>' : ""}</div><div class="s">${esc(d.kiki || "")}・登録 ${when(d.registeredAt)}・最後に開いた ${when(d.seenAt)}</div></div>
        ${uid === myUid() ? "" : `<button class="btn danger" type="button" data-rm="${esc(uid)}" data-n="${esc(d.name || "")}">消す</button>`}</div>`).join("") || '<p class="muted">まだありません</p>'}</div>
      <p class="hint">消すと、そのパソコンはすぐに台帳を見られなくなります。もう一度使うには、合言葉で登録しなおします。台帳は資材便のログインを止めません（同じブラウザでも資材便は使えます）。</p></div>`;
  $$("[data-rm]", body).forEach(b => b.addEventListener("click", async () => {
    if (!confirm(`「${b.dataset.n}」の登録を消しますか？`)) return;
    b.disabled = true;
    try { await call("daichoRemoveDevice")({ uid: b.dataset.rm }); toast(`${b.dataset.n} を消しました`); paintDevices(body, me); }
    catch (ex) { toast(errorText(ex)); b.disabled = false; }
  }));
}

/* ---------- 合言葉を変える ---------- */
function paintCode(body) {
  body.innerHTML = `
    <div class="sec"><h4>台帳の合言葉を変える</h4>
      <p class="hint">変えても、もう登録ずみのパソコンはそのまま使えます（登録のときだけ合言葉を見ます）。合言葉は紙に書かず、口で伝えてください。</p>
      <form id="codeForm" class="form" novalidate>
        <div class="field"><label for="c1">新しい合言葉（6文字以上。8文字以上がおすすめ）</label><input id="c1" class="inp" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="c2">たしかめのため、もう一度</label><input id="c2" class="inp" type="password" autocomplete="new-password"></div>
        <p class="err" id="cErr" role="alert"></p>
        <button class="btn primary big" type="submit" id="cGo">合言葉を変える</button>
      </form></div>`;
  $("#codeForm").addEventListener("submit", async e => {
    e.preventDefault();
    const a = $("#c1").value, b = $("#c2").value, err = $("#cErr"), go = $("#cGo");
    if (a.normalize("NFKC").trim().length < 6) { err.textContent = "6文字以上にしてください"; return; }
    if (a.normalize("NFKC").trim().toLowerCase() !== b.normalize("NFKC").trim().toLowerCase()) { err.textContent = "1回目と2回目がちがいます"; return; }
    go.disabled = true; err.textContent = "";
    try { await call("daichoChangeCode")({ code: a }); toast("合言葉を変えました"); $("#c1").value = ""; $("#c2").value = ""; }
    catch (ex) { err.textContent = errorText(ex); }
    go.disabled = false;
  });
}

/* ---------- 今すぐ保存（台帳の自分のデータを、このパソコンにファイルで） ---------- */
const PATHS = [["daicho/rates", "単価（いつから）"], ["daicho/settei", "設定"], ["daicho/devices", "登録した端末"]];
function paintSave(body, me) {
  body.innerHTML = `
    <div class="sec"><h4>台帳のデータを、このパソコンに保存する</h4>
      <p class="hint">保存するもの：${PATHS.map(p => p[1]).join("・")}。日報と資材便のデータは、それぞれのアプリが持っているので入れません。合言葉も入れません。</p>
      <button class="btn primary big" type="button" id="sGo">今すぐ保存（ファイルをダウンロード）</button>
      <p class="err" id="sErr" role="alert"></p></div>`;
  $("#sGo").addEventListener("click", async () => {
    const go = $("#sGo"), err = $("#sErr");
    go.disabled = true; err.textContent = "";
    try {
      const data = {};
      for (const [p] of PATHS) data[p] = (await get(ref(db, p))).val();
      const now = new Date(), pad = x => String(x).padStart(2, "0");
      const name = `daicho-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
      const blob = new Blob([JSON.stringify({ app: "yotsuba-daicho", kind: "backup", version: 1, savedAt: now.toISOString(), savedBy: me.name || "", data }, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      toast("保存しました：" + name);
    } catch (ex) { err.textContent = errorText(ex); }
    go.disabled = false;
  });
}
