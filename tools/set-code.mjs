// 台帳の合言葉を決める・変える（持ち主が自分のパソコンのターミナルで使う）
//   node tools/set-code.mjs
// - 打った合言葉は画面に出しません。元にもどせない形にしてから、Firebase（yotsuba-daicho）の /daicho/config/code にしまいます
// - Firebase の道具（firebase）に、オーナーのアカウントでログインしている必要があります
// - 合言葉を変えても、もう登録ずみのパソコンはそのまま使えます
// - 資材便の tools/set-code.mjs をお手本にした（資材便の合言葉 /config/codes にはさわらない）
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { hashCode, normalizeCode, MIN_LEN } from "../functions/code.js";

const PROJECT = "yotsuba-daicho";
const PATH = "/daicho/config/code";

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}
function askHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return ask(question + "（このターミナルでは、打った字が見えます）");
  return new Promise(resolve => {
    let buf = "";
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const stop = () => { stdin.removeListener("data", onData); stdin.setRawMode(false); stdin.pause(); };
    function onData(s) {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") { stop(); process.stdout.write("\n"); resolve(buf); return; }
        if (ch === "\u0003") { stop(); process.stdout.write("\nやめました\n"); process.exit(1); }
        if (ch === "\u007f" || ch === "\b") { if (buf) { buf = [...buf].slice(0, -1).join(""); process.stdout.write("\b \b"); } continue; }
        if (ch < " ") continue;
        buf += ch;
        process.stdout.write("*");
      }
    }
    stdin.on("data", onData);
  });
}

console.log("よつば台帳：台帳の合言葉を決める・変える\n");
const first = await askHidden(`台帳の合言葉を入れてください（${MIN_LEN}文字以上。8文字以上がおすすめ）：`);
if ([...normalizeCode(first)].length < MIN_LEN) { console.log(`${MIN_LEN}文字より短いので、やめました`); process.exit(1); }
const again = await askHidden("たしかめのため、もう一度入れてください：");
if (normalizeCode(first) !== normalizeCode(again)) { console.log("1回目と2回目がちがうので、やめました"); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), "daicho-code-"));
const file = join(dir, "code.json");
try {
  writeFileSync(file, JSON.stringify({ ...hashCode(first), setAt: Date.now() }));
  console.log("\nFirebase にしまっています…");
  const r = spawnSync(`firebase database:set ${PATH} "${file}" --project ${PROJECT} --force`, { stdio: "inherit", shell: true });
  if (r.status === 0) console.log("\n台帳の合言葉をしまいました。");
  else { console.log("\nしまえませんでした。`firebase login --reauth` でログインしなおしてから、もう一度ためしてください"); process.exitCode = 1; }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
