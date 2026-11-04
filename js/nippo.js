// 日報（Firebase yotsuba-nippo）を読む ── 読むだけ。日報のデータベースには、ぜったいに書かない（CLAUDE.md の決まり 2）
// - このファイルでは、読む部品（ref・onValue）だけを使う。set・update・push・remove は持ってこない
// - 日報の設定は、日報のページ（nippo.html）に入っている公開の設定と同じ（秘密ではない。資材便の js/nippo.js と同じ）
// - 日報のデータ（11/4 nippo.html・kanri.html を読んで確かめた）：
//   master/jobs/{注番} = {no, name, owner, start, end, fixed, active}、終わった注番は master/closed（並び）
//   master/workers/{w001…} = {name, kubun:"自社"|"協力"|"常駐協力"|"外注協力", shozoku, active}
//   nippo/{YYYY-MM}/rows（並び）：1行＝1人・1日・1工事 {d, n:名前, k, shozoku, no:注番, j:件名, kubun:持ち場, h:{時間の種類:時間}, off, late, early, s, y, …}
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const nippoConfig = {
  apiKey: "AIzaSyDRTF3YW0oTbMcN3cwsmMDJWoLX4HpVtPk",
  authDomain: "yotsuba-nippo.firebaseapp.com",
  databaseURL: "https://yotsuba-nippo-default-rtdb.firebaseio.com",
  projectId: "yotsuba-nippo",
  storageBucket: "yotsuba-nippo.firebasestorage.app",
  messagingSenderId: "1007360975873",
  appId: "1:1007360975873:web:ac229f3f4016b81e994c00"
};
const db = getDatabase(initializeApp(nippoConfig, "nippo"));

/** 日報を見張る。変わるたびに cb({ jobs, workers, rows, months }) を呼ぶ
 *    jobs    … Map(注番 → {name, owner, closed, fixed})（終わった注番も入る）
 *    workers … Map(名前 → {kubun, shozoku, active})
 *    rows    … 日報の行ぜんぶ（休み off の行はのぞく。管理画面の「工事別工数」と同じ）
 *    months  … 日報がある月（新しい順）
 *  返り値：見張るのをやめる関数 */
export function watchNippo(cb, onErr) {
  let jobs = null, closed = null, workers = null, nippo = null;
  const emit = () => {
    if (!jobs || !closed || !workers || !nippo) return;
    const J = new Map();
    for (const j of Object.values(jobs)) {
      if (!j || !j.no) continue;
      J.set(String(j.no), { name: j.name || "", owner: j.owner || "", fixed: !!j.fixed, closed: j.active === false || closed.has(j.no) });
    }
    const W = new Map();
    for (const w of Object.values(workers)) {
      if (!w || !w.name) continue;
      W.set(String(w.name).trim(), { kubun: w.kubun || "", shozoku: w.shozoku || "", active: w.active !== false });
    }
    const rows = [], months = [];
    for (const [ym, m] of Object.entries(nippo)) {
      if (!m || !m.rows) continue;
      months.push(ym);
      for (const r of (Array.isArray(m.rows) ? m.rows : Object.values(m.rows))) {
        if (!r || r.off) continue;
        rows.push({ ...r, no: r.no ? String(r.no).trim() : "", n: String(r.n || "").trim(), d: String(r.d || ym + "-01") });
      }
    }
    cb({ jobs: J, workers: W, rows, months: months.sort().reverse() });
  };
  const offs = [
    onValue(ref(db, "master/jobs"), s => { jobs = s.val() || {}; emit(); }, onErr),
    onValue(ref(db, "master/closed"), s => { closed = new Set(Object.values(s.val() || {})); emit(); }, onErr),
    onValue(ref(db, "master/workers"), s => { workers = s.val() || {}; emit(); }, onErr),
    onValue(ref(db, "nippo"), s => { nippo = s.val() || {}; emit(); }, onErr),
  ];
  return () => offs.forEach(f => f());
}
