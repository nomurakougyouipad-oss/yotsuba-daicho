// 台帳の合言葉での登録（資材便の js/touroku.js をお手本に、台帳用に名前を変えたもの。資材便のファイルは変えていない）
// - 端末ごとの番号は Firebase の匿名ログインで作る（つまり、名前・パスワードなしで1台ずつ番号をふる）
// - 合言葉はサーバー（daichoRegisterDevice）がたしかめて、台帳の役割（dc_role）と名前（dc_name）をつける
// - 登録のあとは getIdToken(true) でトークンを新しくする（しないと、ルールが新しい役割を最大1時間見てくれない）
// - ★ 同じパソコンの同じブラウザだと、資材便と同じログイン（同じ uid）になる。台帳は資材便と別のブラウザで開く決まり（HANDOFF 4-0）
import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { ref, get, update, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import { auth, db, call } from "./firebase.js";

const authReady = new Promise(resolve => {
  const off = onAuthStateChanged(auth, () => { off(); resolve(); });
});

/* 登録した端末の番号を、ブラウザにも控えておく（ログインだけが消えたときに気づけるように） */
const UID_KEY = "yotsuba-daicho-uid";
function lastUid() {
  try { return localStorage.getItem(UID_KEY) || ""; } catch (err) { return ""; }
}
function saveUid(uid) {
  try { localStorage.setItem(UID_KEY, uid); } catch (err) { }
}

/** この端末の登録をしらべる
 *  { role: "office", name, zairyo }  … 登録ずみ（zairyo＝このブラウザは資材便にも登録されている → 注意を出す）
 *  { role: null, removed: true }     … 登録を消された
 *  { role: null, lost: true }        … 登録したはずのログインが、この端末から消えていた
 *  null                              … まだ登録していない */
export async function whoAmI() {
  await authReady;
  const user = auth.currentUser;
  if (!user) return lastUid() ? { role: null, lost: true } : null;
  let { claims } = await user.getIdTokenResult();
  const snap = await get(ref(db, `daicho/devices/${user.uid}`));
  if (!snap.exists()) return claims.dc_role ? { role: null, removed: true, zairyo: !!claims.zr_role } : (claims.zr_role ? { role: null, zairyo: true } : null);
  if (!claims.dc_role) ({ claims } = await user.getIdTokenResult(true));
  if (!claims.dc_role) return null;
  saveUid(user.uid);
  touch(user.uid, snap.val());
  return { role: claims.dc_role, name: claims.dc_name || "", zairyo: !!claims.zr_role };
}

/** 台帳の合言葉で登録する。name＝だれのパソコンか */
export async function register(code, name) {
  if (!auth.currentUser) await signInAnonymously(auth);
  const res = await call("daichoRegisterDevice")({ code, name, kiki: kikiName() });
  if (res.data && res.data.role) {
    await auth.currentUser.getIdToken(true);
    saveUid(auth.currentUser.uid);
  }
  return res.data;
}

/** いまの自分の uid（⚙ 設定で「このパソコン」を見分けるため） */
export const myUid = () => (auth.currentUser ? auth.currentUser.uid : "");

/* ---------- 機種と最後に開いた日 ---------- */
const SEEN_EVERY = 60 * 60 * 1000;

/** この端末の機種（例 Windows・Edge） */
export function kikiName() {
  const ua = navigator.userAgent || "";
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = /iPhone|iPod/.test(ua) ? "iPhone" : ipad ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : "";
  const br = /Edg(A|iOS)?\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung"
    : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join("・") || "わからない";
}

function touch(uid, d) {
  const upd = {};
  if (!d.seenAt || Date.now() - d.seenAt > SEEN_EVERY) upd.seenAt = serverTimestamp();
  const k = kikiName();
  if (d.kiki !== k) upd.kiki = k;
  if (Object.keys(upd).length) update(ref(db, `daicho/devices/${uid}`), upd).catch(() => { });
}

/** まちがいを、やさしい言葉にする */
export function errorText(err) {
  const code = String((err && err.code) || "");
  if (code === "auth/configuration-not-found" || code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
    return "Firebase の「匿名ログイン」がオフになっています。持ち主に知らせてください";
  }
  if (code === "auth/network-request-failed" || code === "functions/unavailable" || code === "functions/deadline-exceeded") {
    return "つながりませんでした。ネットをたしかめて、もう一度ためしてください";
  }
  if (code === "functions/not-found") return "サーバーのプログラム（daicho…）がまだ入っていません。持ち主に知らせてください";
  if (code.startsWith("functions/") && code !== "functions/internal" && err.message) return err.message.replace(/\s*\[\d{3}\]$/, "");
  return "うまくいきませんでした。もう一度ためしてください（" + (code || (err && err.message) || "わからないまちがい") + "）";
}
