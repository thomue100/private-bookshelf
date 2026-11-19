// Auswertung der Fach-Foto-Erkennung mit echten Fotos (npm run eval).
// Liest eval/ (nicht im Repository): je Foto (jpg/png/webp) eine gleichnamige *.expected.json mit den Büchern von links nach rechts:
//   [{ "title": "Momo", "author": "Michael Ende", "isbn": "9783522202107" }, …]   (author und isbn optional)
// Läuft über die echte App-Logik im Browser (recognizeShelf: KI + Katalogsuche + Treffer-Wahl) mit echtem Internet.
// Schlüssel aus ANTHROPIC_API_KEY (bleibt im Test-Browser, wird nirgends gespeichert). Optional EVAL_MODEL=claude-opus-5-5 usw.
// Ergebnis: Tabelle in der Konsole und eval/ergebnisse/<Zeit>.json; die letzte frühere Auswertung wird als „vorher“ gegenübergestellt.
import { test } from "@playwright/test";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../eval/", import.meta.url));
const OUT = join(DIR, "ergebnisse");
const KEY = process.env.ANTHROPIC_API_KEY || "";
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const photos = existsSync(DIR) ? readdirSync(DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f) && existsSync(join(DIR, f.replace(/\.[^.]+$/, ".expected.json")))).sort() : [];

test.skip(!KEY || !photos.length, !KEY ? "ANTHROPIC_API_KEY ist nicht gesetzt – Auswertung übersprungen." : "Keine Fotos mit *.expected.json in eval/ – Auswertung übersprungen.");

test("Fach-Fotos auswerten", async ({ page }) => {
  test.setTimeout(Math.max(1, photos.length) * 8 * 60_000);
  await page.goto("/");
  await page.waitForFunction(() => typeof S !== "undefined" && S.loaded);
  await page.evaluate(([k, m]) => { localStorage.setItem("aiKey", k); if (m) localStorage.setItem("aiModel", m); }, [KEY, process.env.EVAL_MODEL || ""]);
  const model = await page.evaluate(() => aiModel());
  const results = [];
  for (const f of photos) {
    const raw = JSON.parse(readFileSync(join(DIR, f.replace(/\.[^.]+$/, ".expected.json")), "utf8"));
    const exp = Array.isArray(raw) ? raw : raw.books || [];
    const b64 = readFileSync(join(DIR, f)).toString("base64");
    console.log(`… ${f} (${exp.length} Bücher erwartet)`);
    const r = await page.evaluate(async ({ b64, mime, exp, name }) => {
      const blob = await (await fetch(`data:${mime};base64,${b64}`)).blob();
      const run = recRun("eval", { datei: name });
      const t0 = performance.now();
      let rec = null, err = "";
      try { rec = await recognizeShelf(blob, { run }); } catch (e) { err = e.message || String(e); }
      const items = rec ? rec.items.filter(it => it.kind !== "other") : [];
      const sim = (a, b) => overlap(a || "", b || "");
      const used = new Set();
      const rows = exp.map(e => {
        let best = -1, bs = 0;
        items.forEach((it, i) => { if (used.has(i)) return; const s = sim(e.title, [it.title, it.subtitle].filter(Boolean).join(" ")); if (s > bs) { bs = s; best = i; } });
        const ok = bs >= 0.5; if (ok) used.add(best);
        const it = ok ? items[best] : null;
        const right = c => !!c && (toIsbn13(e.isbn) ? toIsbn13(e.isbn) === toIsbn13(c.isbn) : sim(e.title, c.title) >= 0.6 && (!e.author || sim(e.author, c.author) > 0));
        const chosen = it && it.choice >= 0 ? it.cands[it.choice] : null;
        return { erwartet: e.title, gelesen: it ? it.title : "", titelOk: ok, auto: !!chosen, autoRichtig: right(chosen), autoFalsch: !!chosen && !right(chosen),
          unterKandidaten: !!it && it.cands.some(right), gewaehlt: chosen ? `${chosen.title} – ${chosen.author || "?"}${chosen.isbn ? " · " + chosen.isbn : ""}` : "", warum: it ? choiceWhy(it) : "" };
      });
      const phantom = items.filter((_, i) => !used.has(i));
      return {
        datei: name, fehler: err, sekunden: Math.round((performance.now() - t0) / 100) / 10,
        erwartet: exp.length, ruecken: items.length,
        titelRichtig: rows.filter(x => x.titelOk).length,
        autoRichtig: rows.filter(x => x.autoRichtig).length,
        unterKandidaten: rows.filter(x => x.unterKandidaten).length,
        autoFalsch: rows.filter(x => x.autoFalsch).length + phantom.filter(it => it.choice >= 0).length,
        zusaetzlich: phantom.map(it => it.title),
        ki: run.ai.map(a => ({ stop_reason: a.stop_reason, sekunden: a.ms / 1000, usage: a.usage, fehler: a.err })),
        zeilen: rows,
      };
    }, { b64, mime: MIME[f.split(".").pop().toLowerCase()], exp, name: f });
    results.push(r);
  }
  // Summen und Tabelle
  const sum = k => results.reduce((n, r) => n + (r[k] || 0), 0);
  const total = { erwartet: sum("erwartet"), ruecken: sum("ruecken"), titelRichtig: sum("titelRichtig"), autoRichtig: sum("autoRichtig"), unterKandidaten: sum("unterKandidaten"), autoFalsch: sum("autoFalsch") };
  const pct = (n, d) => d ? Math.round(n / d * 100) + " %" : "–";
  const line = (label, t) => ({ "": label, "Rücken gefunden": `${t.ruecken}/${t.erwartet}`, "Titel richtig gelesen": `${t.titelRichtig} (${pct(t.titelRichtig, t.erwartet)})`,
    "richtiger Treffer automatisch": `${t.autoRichtig} (${pct(t.autoRichtig, t.erwartet)})`, "richtiger Treffer unter Kandidaten": `${t.unterKandidaten} (${pct(t.unterKandidaten, t.erwartet)})`, "FALSCH automatisch": t.autoFalsch });
  mkdirSync(OUT, { recursive: true });
  const prevFile = existsSync(OUT) ? readdirSync(OUT).filter(f => f.endsWith(".json")).sort().pop() : null;
  const prev = prevFile ? JSON.parse(readFileSync(join(OUT, prevFile), "utf8")) : null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  writeFileSync(join(OUT, `${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), model, total, results }, null, 2));
  console.log(`\nModell: ${model} · ${photos.length} Fotos · Ergebnis gespeichert in eval/ergebnisse/${stamp}.json\n`);
  console.table(results.map(r => line(r.datei + (r.fehler ? " ⚠ " + r.fehler : ""), r)));
  const rows = [line("jetzt", total)];
  if (prev?.total) rows.unshift(line(`vorher (${prevFile.replace(".json", "")}, ${prev.model})`, prev.total));
  console.table(rows);
});
