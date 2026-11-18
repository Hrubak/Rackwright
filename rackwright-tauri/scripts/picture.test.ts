import { parseTsv, wordsToLabels, WIRE_NOTE_RE } from "../src/imports/picture";

let fails = 0;
const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); };

// real TSV columns: level page block par line word left top width height conf text
const row = (lvl: number, block: number, line: number, word: number, l: number, tp: number, w: number, h: number, conf: number, text: string) =>
  [lvl, 1, block, 1, line, word, l, tp, w, h, conf, text].join("	");
const tsv = [
  "level	page_num	block_num	par_num	line_num	word_num	left	top	width	height	conf	text",
  row(4, 1, 1, 0, 0, 0, 0, 0, -1, ""),
  row(5, 1, 1, 1, 100, 40, 80, 20, 91.5, "EX-SW01"),
  row(5, 1, 1, 2, 300, 40, 50, 20, 30, "noise"),
  row(5, 1, 1, 3, 400, 40, 10, 20, 95, "|"),
  row(5, 1, 1, 4, 500, 40, 10, 20, 95, "-"),
  row(5, 1, 2, 1, 100, 80, 90, 20, 88, "10.0.0.2"),
].join("\n");
const words = parseTsv(tsv, 2);
t("keeps good level-5 rows only", words.length === 2, JSON.stringify(words.map((w) => w.text)));
t("coordinates are divided by scale", words[0].x === 50 && words[0].y === 20 && words[0].w === 40 && words[0].h === 10, JSON.stringify(words[0]));
t("confidence kept", words[0].conf === 91.5);
t("low confidence dropped", !words.some((w) => w.text === "noise"));
t("punctuation-only dropped", !words.some((w) => /^[|-]$/.test(w.text)));
t("header and non-word rows ignored", parseTsv("", 1).length === 0);

// two lines in the same column, one line apart, plus a far-away word
const W = (k: string, x: number, y: number, text: string) => ({ k, x, y, w: text.length * 8, h: 14, text, conf: 90 });
const { labels, lh } = wordsToLabels([W("1.1.1", 100, 100, "EX-SW01"), W("1.2.1", 104, 118, "10.0.0.2"), W("2.1.1", 600, 400, "EX-SRV01")]);
t("stacked words become one label", labels.some((l) => l.text === "EX-SW01\n10.0.0.2"), JSON.stringify(labels.map((l) => l.text)));
t("far word stays separate", labels.some((l) => l.text === "EX-SRV01") && labels.length === 2);
t("line height is the median", lh === 14);

t("wire notes", WIRE_NOTE_RE.test("Gi1/0/1") && WIRE_NOTE_RE.test("VLAN 20") && WIRE_NOTE_RE.test("10G") && !WIRE_NOTE_RE.test("EX-SW01"));

console.log(fails ? `picture: ${fails} failed` : "picture: all passed");
if (fails) process.exit(1);
