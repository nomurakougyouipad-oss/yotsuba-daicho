// Firebase（yotsuba-daicho）につなぐ ── 資材便と同じ Firebase。台帳は /daicho/… に自分のデータを置き、/zairyo/… と /common/… は読むだけ
// - 下の設定はページに入れてよいもの（秘密ではありません。資材便の js/firebase.js と同じ）。秘密（APIキー sk-ant- …・合言葉）はここに書かない
// - Firebase の部品の版は、ほかのよつばのアプリと同じ 12.19.0
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { initializeAuth, browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBcbbpWgnsUO00_CkvSEV7QLCl0sXjKlEw",
  authDomain: "yotsuba-daicho.firebaseapp.com",
  databaseURL: "https://yotsuba-daicho-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "yotsuba-daicho",
  storageBucket: "yotsuba-daicho.firebasestorage.app",
  messagingSenderId: "263998950615",
  appId: "1:263998950615:web:5299df16af54fee4bfb492"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
// ログインの保存場所：localStorage を先に使う（資材便と同じ）
export const auth = initializeAuth(app, {
  persistence: [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence],
});
const functions = getFunctions(app, "asia-southeast1");   // サーバーのプログラムの場所（データベースと同じシンガポール）

/** サーバーのプログラムを呼ぶ。call("daichoRegisterDevice")({ … }) */
export const call = (name, opts) => httpsCallable(functions, name, opts);

/** データベースにつながっているかを見張ります。cb(true / false) */
export function watchConnected(cb) {
  return onValue(ref(db, ".info/connected"), snap => cb(snap.val() === true));
}

/** 登録した台帳の端末だけが読める所（単価の表）を読めるかをたしかめます */
export async function canReadDaicho() {
  try {
    await get(ref(db, "daicho/rates"));
    return true;
  } catch (err) {
    if (/permission/i.test(String(err && err.message))) return false;
    throw err;
  }
}
