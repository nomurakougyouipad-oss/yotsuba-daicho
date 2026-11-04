// 資材便のルールのファイルに、台帳の分を足す（HANDOFF 4-0 の1・4-1 の1と4）
//   見るだけ：  node tools/rules-add.mjs ../yotsuba-zairyo
//   書きこむ：  node tools/rules-add.mjs ../yotsuba-zairyo --write
// - 足すもの：/daicho（rules/daicho-rules.json）、/zairyo/orders の .read と /common の .read に「台帳の端末も読める」
// - 書きこむ前に、前のルールを 資材便/backups/rules-before-daicho-<日付>.json に保存する
// - 前と後をくらべて「消えた所 0・変わった所は .read の2つだけ・足した所は /daicho だけ」をたしかめ、ちがえば書きこまない
// - 入れる（firebase deploy --only database）のは、資材便のフォルダから。このフォルダからは入れない
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const zairyoDir = resolve(process.argv[2] || join(here, "..", "..", "yotsuba-zairyo"));
const write = process.argv.includes("--write");
const rulesPath = join(zairyoDir, "database.rules.json");
if (!existsSync(rulesPath)) { console.log(`資材便のルールのファイルが見つかりません：${rulesPath}`); process.exit(1); }

const add = JSON.parse(readFileSync(join(here, "..", "rules", "daicho-rules.json"), "utf8"));
const DC = add["_台帳の端末"];
const before = JSON.parse(readFileSync(rulesPath, "utf8"));
const after = JSON.parse(JSON.stringify(before));
const R = after.rules;

const changes = [];
/** .read に台帳の端末を足す（もう足してあれば、そのまま） */
function addRead(node, path) {
  if (!node) { console.log(`${path} がルールにありません。資材便のルールが変わっています → 持ち主に報告`); process.exit(1); }
  const cur = String(node[".read"] || "");
  if (cur.includes("dc_role")) { changes.push(`${path}/.read … もう足してある`); return; }
  node[".read"] = `(${cur}) || (${DC})`;
  changes.push(`${path}/.read … 「|| (台帳の端末)」を足した`);
}
addRead(R.zairyo && R.zairyo.orders, "/zairyo/orders");
addRead(R.common, "/common");
if (R.daicho) changes.push("/daicho … もうある（新しい中身に入れかえる）");
else changes.push("/daicho … 足した");
R.daicho = add.daicho;

/* ---------- くらべる：前のルールの中身が、後にも全部そのまま残っているか ---------- */
const gone = [], changed = [];
function walk(a, b, path) {
  for (const k of Object.keys(a)) {
    const p = path + "/" + k;
    if (!(k in b)) { gone.push(p); continue; }
    if (typeof a[k] === "object" && a[k] !== null) {
      if (typeof b[k] !== "object" || b[k] === null) { changed.push(p); continue; }
      walk(a[k], b[k], p);
    } else if (a[k] !== b[k]) {
      changed.push(p);
    }
  }
}
walk(before, after, "");
const okChanged = changed.every(p => p === "/rules/zairyo/orders/.read" || p === "/rules/common/.read");
const added = Object.keys(R).filter(k => !(k in before.rules));
const okAdded = added.every(k => k === "daicho");
for (const p of changed) {
  const b = String(getPath(before, p)), a = String(getPath(after, p));
  if (!a.startsWith("(" + b + ")")) { console.log(`${p} は、前の中身をそのまま含んでいません → 書きこみません`); process.exit(1); }
}
function getPath(obj, p) { return p.split("/").filter(Boolean).reduce((o, k) => (o ? o[k] : undefined), obj); }

console.log("=== くらべた結果 ===");
console.log(`消えた所：${gone.length}`);
console.log(`変わった所：${changed.length}（${changed.join("・") || "なし"}）`);
console.log(`足した所：${added.length}（${added.join("・") || "なし"}）`);
console.log("");
for (const c of changes) console.log("・" + c);
if (gone.length || !okChanged || !okAdded) {
  console.log("\n△ 想定とちがいます。書きこみません。持ち主に報告してください");
  process.exit(1);
}

const text = JSON.stringify(after, null, 2) + "\n";
if (!write) {
  const out = join(here, "..", "rules", "merged-preview.json");
  writeFileSync(out, text);
  console.log(`\n見るだけ：足したあとのルールを ${out} に書きました（資材便のファイルは変えていません）`);
  console.log("書きこむときは --write をつけて、もう一度");
  process.exit(0);
}
const d = new Date(), pad = x => String(x).padStart(2, "0");
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
mkdirSync(join(zairyoDir, "backups"), { recursive: true });
const bk = join(zairyoDir, "backups", `rules-before-daicho-${stamp}.json`);
writeFileSync(bk, readFileSync(rulesPath));
writeFileSync(rulesPath, text);
console.log(`\n前のルールを保存：${bk}`);
console.log(`書きこみました：${rulesPath}`);
console.log("\nつぎ：資材便のフォルダで  firebase deploy --only database --project yotsuba-daicho");
console.log("そのあと、資材便の事務所の画面と台帳の画面がどちらも開くかをたしかめる");
