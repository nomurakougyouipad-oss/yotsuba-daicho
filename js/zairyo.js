// 資材便（同じ Firebase の /zairyo/…）と台帳ぜんたいの表（/common/…）を読む ── 読むだけ。資材便のデータには、ぜったいに書かない（CLAUDE.md の決まり 3）
// - このファイルでは、読む部品（ref・onValue）だけを使う
// - 読むには、ルールに「台帳の端末（dc_role＝office）も読める」が足してある必要がある（HANDOFF 4-1 の 4）。
//   まだ足していないと permission のまちがいになる → 画面に「資材便を読む許可がまだ」と出す
// - /zairyo/orders/{id}：chuban・kenmei・supplierName・status（wait／arrived／billed／cancelled）・kind（kakou／mekki／…）・
//   nouhin・seikyu（税抜）・orderedAt・arrivedAt・billedAt（ミリ秒）
import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { db } from "./firebase.js";

/** 資材便の注文を見張る。cb(orders)：取り消し（cancelled）はのぞいた配列。onErr(err)：読めないとき */
export function watchOrders(cb, onErr) {
  return onValue(ref(db, "zairyo/orders"), s => {
    const v = s.val() || {};
    cb(Object.entries(v)
      .map(([id, o]) => ({ id, ...o, chuban: o && o.chuban ? String(o.chuban).trim() : "" }))
      .filter(o => o && o.status !== "cancelled"));
  }, onErr);
}

/** 注番の会社の表・固定の注番を見張る。cb({ kaisha, kotei, chubanYear }) */
export function watchCommon(cb, onErr) {
  return onValue(ref(db, "common"), s => {
    const v = s.val() || {};
    cb({ kaisha: v.kaisha || {}, kotei: v.kotei || {}, chubanYear: v.chubanYear || "" });
  }, onErr);
}

/** 台帳の自分のデータを見張る。cb({ rates, settei, freeMap, groups })
 *  settei … { matDate, kessanMonth, cutDay, uri:{区分:円} }（11/6 全部の端末で同じにするため Firebase に移した）
 *  freeMap … { id: { name:注番なしの件名, to:お客さん } }
 *  groups … { map:{頭2文字: まとめの名前}, names:{まとめの名前: true} } */
export function watchDaicho(cb, onErr) {
  const v = { rates: null, settei: null, freeMap: null, groups: null };
  const emit = () => { if (Object.values(v).every(x => x !== null)) cb({ ...v }); };
  const offs = ["rates", "settei", "freeMap", "groups"].map(k => onValue(ref(db, "daicho/" + k), s => { v[k] = s.val() || {}; emit(); }, onErr));
  return () => offs.forEach(f => f());
}
