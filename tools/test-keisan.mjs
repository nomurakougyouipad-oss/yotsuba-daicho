// 計算のたしかめ（ブラウザも Firebase もいらない）：node tools/test-keisan.mjs
// 「OK」が並べばよい。「NG」が出たら js/keisan.js を直す
import { KINDS, PLACES, placeOf, rateTable, rateFor, net, ninku, laborOf, groupOf, cost, orderDate, jobStats, allJobs, sumOf, companyOf, monthsOf } from "../js/keisan.js";

let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "OK " : "NG ") + name + (ok ? "" : `\n    もらった ${JSON.stringify(got)}\n    ほしい   ${JSON.stringify(want)}`));
  if (!ok) bad++;
};

// 1) はじめの単価：全部 2,500円
const t0 = rateTable(null);
eq("単価の表がからのとき、はじめの単価", rateFor(t0, "2026-11-04").kinds["深夜"], 2500);

// 2) いつから：11/1 から深夜 3,000円。10/31 の行は 2,500円のまま
const t1 = rateTable({ "2026-11-01": { kinds: { 深夜: 3000 } } });
eq("11/1 以降は新しい単価", rateFor(t1, "2026-11-01").kinds["深夜"], 3000);
eq("10/31 は前の単価", rateFor(t1, "2026-10-31").kinds["深夜"], 2500);
eq("書かなかった種類ははじめの単価", rateFor(t1, "2026-11-10").kinds["平日工場"], 2500);

// 3) 1行の計算：平日現場 8h ＋ 現場残業 2h、遅刻 1h
const row = { d: "2026-10-15", n: "見本A", no: "AA26031", h: { 平日現場: 8, 現場残業: 2 }, late: 1, early: 0 };
eq("実働＝8+2−1", net(row), 9);
eq("人工＝8÷8", ninku(row), 1);
eq("労務費＝(8+2)×2500−1×2500", laborOf(row, rateFor(t0, row.d)), 22500);

// 4) 残業だけ単価を変えたとき
const t2 = rateTable({ "2026-01-01": { kinds: { 現場残業: 3125 }, minus: "平日現場" } });
eq("残業 3,125円・遅刻は平日現場の単価で引く", laborOf(row, rateFor(t2, row.d)), 8 * 2500 + 2 * 3125 - 2500);

// 5) 会社の区分
const workers = new Map([["見本A", { kubun: "自社" }], ["見本B", { kubun: "協力" }], ["見本C", { kubun: "外注協力" }]]);
eq("自社", groupOf("見本A", workers), "自社");
eq("古い「協力」は常駐協力", groupOf("見本B", workers), "常駐協力");
eq("外注協力", groupOf("見本C", workers), "外注協力");
eq("名簿にない人は行の k で（k が自社でない→常駐協力）", groupOf("だれか", workers, { k: "協力" }), "常駐協力");
eq("名簿にない人・k なし→自社", groupOf("だれか", workers, {}), "自社");

// 6) 材料費：請求 → なければ納品 → なければ「まだ」
eq("請求があれば請求", cost({ seikyu: 97500, nouhin: 98000 }), 97500);
eq("請求がなければ納品", cost({ nouhin: 98000 }), 98000);
eq("どちらもなければ まだ", cost({}), null);

// 7) 工事ごとのまとめ（取り消しの注文は、渡す前にのぞく決まり）
const rows = [
  row,
  { d: "2026-11-02", n: "見本B", no: "AA26031", h: { 平日工場: 8 }, k: "協力" },
  { d: "2026-11-02", n: "見本C", no: "AA26031", h: { 休日現場: 8, 深夜: 2 } },
  { d: "2026-11-03", n: "見本A", no: "", j: "工場内 片付け", h: { 平日工場: 4 } },
];
const T = (d) => new Date(d + "T10:00:00").getTime();
const orders = [
  { chuban: "AA26031", status: "billed", nouhin: 18400, seikyu: 18400, orderedAt: T("2026-10-12"), billedAt: T("2026-11-20") },
  { chuban: "AA26031", status: "arrived", nouhin: 126500, orderedAt: T("2026-11-03"), kind: "mekki" },
  { chuban: "AA26031", status: "wait", orderedAt: T("2026-11-04") },
];
const opts = { workers, rates: t0, matDate: "ordered" };
const s = jobStats(rows.filter(r => r.no === "AA26031"), orders, "all", opts);
eq("労務費の合計（全期間）", s.labor, 22500 + 20000 + 25000);
eq("区分ごと", s.lg, { 自社: 22500, 常駐協力: 20000, 外注協力: 25000 });
eq("材料費＝18400+126500（まだの注文は0）", s.mat, 144900);
eq("金額まだ 1件", s.noPrice, 1);
eq("めっき 126500", s.mekki, 126500);
eq("人工＝1+1+1", s.ninku, 3);
const s10 = jobStats(rows.filter(r => r.no === "AA26031"), orders, "2026-10", opts);
eq("10月の分：労務費は10/15の行だけ", s10.labor, 22500);
eq("10月の分：材料費は10/12に注文した分だけ（注文した日で分ける）", s10.mat, 18400);
const s11b = jobStats(rows.filter(r => r.no === "AA26031"), orders, "2026-11", { ...opts, matDate: "billed" });
eq("請求の日で分けると、11月に請求の18400も入る", s11b.mat, 18400 + 126500);

// 8) 工事の一覧（注番なし・日報にない注番）
const jobs = new Map([["AA26031", { name: "見本 排水ポンプ", owner: "見本D", closed: false }]]);
const kaisha = { AA: { name: "見本ポンプ保全" } };
const kotei = { BB000: { name: "見本工場" }, CC888: { name: "見本整備" } };
const list = allJobs({ rows, orders: [...orders, { chuban: "BB26000", status: "arrived", nouhin: 5000, orderedAt: T("2026-11-01") }, { chuban: "ZZ26001", kenmei: "注文の件名", status: "wait", orderedAt: T("2026-11-01") }], jobs, period: "all", kaisha, kotei, workers, rates: t0, matDate: "ordered" });
const byKey = Object.fromEntries(list.map(x => [x.key, x]));
eq("工事は4つ", list.length, 4);
eq("日報の件名", byKey["AA26031"].name, "見本 排水ポンプ");
eq("お客さん", byKey["AA26031"].comp, { code: "AA", name: "見本ポンプ保全" });
eq("固定の注番は名前が出る", byKey["BB26000"].name, "見本工場");
eq("固定の注番は「固定」", byKey["BB26000"].comp.code, "固定");
eq("日報にない注番は注文の件名", byKey["ZZ26001"].name, "注文の件名");
eq("会社の表にない頭文字", byKey["ZZ26001"].comp.name, "頭文字 ZZ（会社の表にない）");
eq("注番なしは件名でまとまる", byKey["free:工場内 片付け"].free, true);
eq("合計の労務費", sumOf(list).labor, 67500 + 10000);
eq("月の一覧（新しい順）", monthsOf(rows, orders, "ordered"), ["2026-11", "2026-10"]);
eq("companyOf 固定（CC26888）", companyOf("CC26888", kaisha, kotei).code, "固定");
eq("KINDS は 11こ", KINDS.length, 11);

// 9) 持ち場 → 工場・現場・その他（11/4。事務所・倉庫番は 11/5）
eq("「工場」と名のつく持ち場は工場", placeOf({ kubun: "見本工場" }), "工場");
eq("北吉田は工場", placeOf({ kubun: "北吉田" }), "工場");
eq("現場は現場", placeOf({ kubun: "現場" }), "現場");
eq("常駐先・ほかの会社の構内・緑化は現場", [placeOf({ kubun: "見本常駐" }), placeOf({ kubun: "見本製鉄" }), placeOf({ kubun: "緑化" }), placeOf({ kubun: "見本発電所" })], ["現場", "現場", "現場", "現場"]);
eq("設計・その他・空はその他", [placeOf({ kubun: "設計" }), placeOf({ kubun: "その他" }), placeOf({})], ["その他", "その他", "その他"]);
eq("事務所・倉庫番はその他", [placeOf({ kubun: "事務所" }), placeOf({ kubun: "見本倉庫番" })], ["その他", "その他"]);
{
  const rows2 = [
    { d: "2026-10-01", n: "見本A", no: "AA26001", kubun: "見本工場", h: { 平日工場: 8 } },
    { d: "2026-10-02", n: "見本A", no: "AA26001", kubun: "現場", h: { 平日現場: 8, 移動行き: 1 } },
    { d: "2026-10-03", n: "見本A", no: "AA26001", kubun: "設計", h: { 平日工場: 2 } },
  ];
  const s2 = jobStats(rows2, [], "all", { workers: new Map(), rates: rateTable(null), matDate: "ordered" });
  eq("工場・現場・その他の労務費", s2.lp, { 工場: 20000, 現場: 22500, その他: 5000 });
  eq("工場＋現場＋その他＝労務費の合計", PLACES.reduce((a, g) => a + s2.lp[g], 0), s2.labor);
}

console.log(bad ? `\nNG が ${bad} こあります` : "\nぜんぶ OK");
process.exit(bad ? 1 : 0);
