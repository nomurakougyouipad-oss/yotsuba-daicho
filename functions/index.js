// よつば台帳 サーバーのプログラム（Cloud Functions）
// - 場所はデータベースと同じシンガポール（asia-southeast1）。資材便と同じ Firebase（yotsuba-daicho）
// - firebase.json の codebase は "daicho"。名前は daicho で始める（資材便の zairyo… とぶつからないように）
// - 入れるときは deploy-daicho.bat（firebase deploy --only functions:daicho）。資材便のプログラムを「消しますか？」と聞かれたら、いいえ
// - 役割は「アプリごと」（10/12）：台帳の役割は dc_role、名前は dc_name。ほかのアプリの印（資材便の zr_…）は消さずに残す
// - 合言葉（元にもどせない形）は /daicho/config/code。まちがいの回数は /daicho/config/tries。ルールでは /daicho/config は読めない・書けない（ここからだけ）
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { ServerValue } from "firebase-admin/database";
import { verifyCode, hashCode, normalizeCode, MIN_LEN } from "./code.js";
import { db, requireDaicho } from "./lib.js";

setGlobalOptions({ region: "asia-southeast1", maxInstances: 3, memory: "256MiB", timeoutSeconds: 30 });
initializeApp();

const NAME_MAX = 20;
const KIKI_MAX = 40;

/* ---------- 合言葉の当てずっぽうを防ぐ（資材便と同じ考え） ----------
   同じ端末で5回まちがえたら15分止める。だれが打っても1時間に30回まちがえたら、登録を全部15分止める */
const TRY = { uidFails: 5, allFails: 30, windowMs: 60 * 60 * 1000, lockMs: 15 * 60 * 1000 };
const LOCKED_MSG = "まちがいが多いので、しばらく止めています。15分ほどたってから、もう一度ためしてください";

async function checkLock(uid) {
  const now = Date.now();
  const [one, all] = await Promise.all([
    db().ref(`daicho/config/tries/uid/${uid}/lockUntil`).get(),
    db().ref("daicho/config/tries/all/lockUntil").get(),
  ]);
  if ((one.val() || 0) > now || (all.val() || 0) > now) throw new HttpsError("resource-exhausted", LOCKED_MSG);
}
function bump(max, now) {
  return cur => {
    const c = cur && now - (cur.since || 0) < TRY.windowMs ? { ...cur } : { since: now, fails: 0 };
    c.fails = (c.fails || 0) + 1;
    if (c.fails >= max) { c.lockUntil = now + TRY.lockMs; c.since = now; c.fails = 0; }
    return c;
  };
}
async function countFail(uid) {
  const now = Date.now();
  await Promise.all([
    db().ref(`daicho/config/tries/uid/${uid}`).transaction(bump(TRY.uidFails, now)),
    db().ref("daicho/config/tries/all").transaction(bump(TRY.allFails, now)),
  ]);
}
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);

/** 台帳の端末を登録する。data = { code, name（だれのパソコンか）, kiki（機種） } → { role: "office", name } */
export const daichoRegisterDevice = onCall({ invoker: "public" }, async request => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインできていません。ページを開きなおしてください");
  const data = request.data || {};
  await checkLock(uid);
  const saved = (await db().ref("daicho/config/code").get()).val();
  if (!saved) throw new HttpsError("failed-precondition", "台帳の合言葉がまだ決まっていません。持ち主に知らせてください（tools/set-code.mjs）");
  if (!verifyCode(data.code, saved)) {
    await countFail(uid);
    throw new HttpsError("permission-denied", "合言葉がちがいます");
  }
  const name = clean(data.name, 200);
  if (!name) throw new HttpsError("invalid-argument", "このパソコンの名前を入れてください");
  if ([...name].length > NAME_MAX) throw new HttpsError("invalid-argument", `名前は${NAME_MAX}文字までにしてください`);

  const auth = getAuth();
  const user = await auth.getUser(uid);
  // ほかのアプリの印（資材便の zr_role など）は消さずに残す
  await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), dc_role: "office", dc_name: name });
  const kiki = clean(data.kiki, KIKI_MAX);
  await db().ref(`daicho/devices/${uid}`).set({
    role: "office", name, registeredAt: ServerValue.TIMESTAMP, seenAt: ServerValue.TIMESTAMP, ...(kiki ? { kiki } : {}),
  });
  await db().ref(`daicho/config/tries/uid/${uid}`).remove();
  return { role: "office", name };
});

/** 登録した端末を消す。data = { uid }
 *  - /daicho/devices/{uid} を消すので、ルールですぐ読めなくなる
 *  - 台帳の印（dc_role・dc_name）だけ外す。ほかのアプリの印（資材便）は残す
 *  - ★ 資材便とちがい revokeRefreshTokens（ログインのしるしを使えなくする）はしない。台帳は写真の置き場（Storage）を使わず、
 *    ルールが /daicho/devices を見るので、消したらすぐ止まる。同じブラウザの資材便のログインを止めないため（HANDOFF 4-1 の 3）
 *  - ほかのアプリの印もなければ、ログインごと消す
 *  - いま使っている自分のパソコンは消せない */
export const daichoRemoveDevice = onCall({ invoker: "public" }, async request => {
  const me = await requireDaicho(request);
  const uid = String((request.data || {}).uid || "");
  if (!uid || uid.length > 128 || /[.#$\[\]\/]/.test(uid)) throw new HttpsError("invalid-argument", "消す端末がわかりません");
  if (uid === me.uid) throw new HttpsError("failed-precondition", "いま使っているこのパソコンは、ここからは消せません");
  const d = (await db().ref(`daicho/devices/${uid}`).get()).val();
  if (!d) throw new HttpsError("not-found", "その端末は、もう消されています");

  const auth = getAuth();
  try {
    const user = await auth.getUser(uid);
    const claims = { ...(user.customClaims || {}) };
    delete claims.dc_role;
    delete claims.dc_name;
    if (Object.keys(claims).length) await auth.setCustomUserClaims(uid, claims);
    else await auth.deleteUser(uid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }
  await db().ref(`daicho/devices/${uid}`).remove();
  return { removed: d.name || "", by: me.name };
});

/** 台帳の合言葉を変える。data = { code }。変えても、もう登録ずみのパソコンはそのまま使える */
export const daichoChangeCode = onCall({ invoker: "public" }, async request => {
  const me = await requireDaicho(request);
  const code = (request.data || {}).code;
  if ([...normalizeCode(code)].length < MIN_LEN) throw new HttpsError("invalid-argument", `合言葉は${MIN_LEN}文字以上にしてください`);
  await db().ref("daicho/config/code").set({ ...hashCode(code), setAt: Date.now(), setBy: me.name });
  return { ok: true };
});
