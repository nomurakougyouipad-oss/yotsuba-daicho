// サーバーのプログラムで共通に使う部品（台帳用。資材便の functions/lib.js をお手本にした）
import { HttpsError } from "firebase-functions/v2/https";
import { getDatabase } from "firebase-admin/database";

// データベースは使うときにつなぐ（読みこみのときにつなぐと、Firebase に入れるときの下しらべで止まる）
let database;
export const db = () => (database ||= getDatabase());

/** 呼んだのが台帳の端末（dc_role＝office）で、登録が消されていないこと。{uid, name} を返す */
export async function requireDaicho(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid || request.auth.token.dc_role !== "office") throw new HttpsError("permission-denied", "台帳に登録したパソコンだけができます");
  const d = (await db().ref(`daicho/devices/${uid}`).get()).val();
  if (!d || d.role !== "office") throw new HttpsError("permission-denied", "このパソコンの登録が消されています");
  return { uid, name: d.name || "" };
}
