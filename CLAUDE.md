# CLAUDE.md – Regeln für die Arbeit an „private-bookshelf“

Persönliche Bücherverwaltung als PWA („Mein Bücherregal“). Bücher werden am Handy oder PC erfasst
(Barcode, Cover-Foto, Fach-Foto, von Hand) und bleiben **ausschließlich im Browser des Geräts** (IndexedDB).
Abgleich zwischen Geräten per Sicherungsdatei (Export/Import), automatischer Sicherung in einen lokalen Ordner oder – optional –
über einen **eigenen CouchDB-Server des Nutzers** (auf seinem PC, erreichbar über Tailscale; siehe `docs/ABGLEICH-EINRICHTEN.md`).

## Grundsätze (nicht verhandelbar)

1. **Vorhandene Daten müssen weiter funktionieren.** Die Nutzerin/der Nutzer hat bereits eine Buchdatenbank.
   - IndexedDB `buecherregal` Version 4 mit Stores `books` (keyPath `id`), `meta` (keyPath `key`), `blobs` (keyPath `id`, Index `bookId`),
     `photos` (keyPath `id`, gespeicherte Fach-Fotos, seit Version 3), `stack` (keyPath `id`, Stapel-Erfassung, seit Version 4 –
     nur lokal, nicht in Sicherung und Abgleich).
     Schema nur **additiv** erweitern (neuer Store/Index → Version erhöhen, `onupgradeneeded` darf nichts löschen oder umbauen).
   - Neue Buchfelder sind **optional**. Alter Datensatz ohne das Feld muss überall funktionieren (Anzeige, Tabelle, CSV, Filter, Sicherung).
     Felder nie umbenennen oder umdeuten; alte Felder beim Lesen übersetzen (Beispiel: `startedAt`/`finishedAt` → `readsOf(b)`).
   - **Sicherungen Version 1 und 2 müssen importierbar bleiben** (`importData`). Format: `{app:"buecherregal", version:2, books, deleted, shelves}`;
     Cover als `coverData` (data-URL), Buchrücken-Bild als `spine.imageData`, Anhänge optional mit `data`.
     Optional `photos` (Fach-Fotos ohne `blob`; offene mit `imageData`) – fehlt, wenn es keine gibt.
     Abgleich: neuere `updatedAt` gewinnt, Löschungen über `deleted` (Grabsteine).
2. **Keine Cloud für Buchdaten.** Buchdaten gehen nur an den vom Nutzer selbst eingetragenen CouchDB-Server. Sonst erlaubt sind nur
   Abfragen an Kataloge/Suchen (Google Books, DNB, lobid/hbz-Bibliotheksverbund, K10plus/GBV per SRU, Open Library, Google-Bildersuche) und – nur wenn eingerichtet – die Anthropic-API
   mit dem Schlüssel des Nutzers. Zugangsdaten (Server, KI-Schlüssel) gehören nie in Sicherungsdateien.
3. **Läuft ohne Claude.** Alle KI-Funktionen sind optional; es gibt immer einen Weg ohne (Barcode, Hand-Eingabe, Claude-Chat-Brücke).
   Die frühere Texterkennung (Tesseract/OCR) ist bewusst entfernt – zu ungenau; nicht wieder einbauen.
4. **Kein Build-Schritt, keine Frameworks.** Reines HTML/CSS/JavaScript in `app/`, direkt auslieferbar. Externe Bibliotheken nur per CDN
   und nur bei Bedarf nachgeladen (ZXing).
5. **Oberfläche auf Deutsch**, freundlich und ohne Fachjargon. Muss am Handy (390 px breit) und am PC benutzbar sein.

## Aufbau

| Datei | Inhalt |
|---|---|
| `app/index.html` | Gerüst, Navigation (`#regal`, `#wand`, `#wunsch`, `#verwaltung`), Skripte in fester Reihenfolge (alle `defer`) |
| `app/app.js` | Kern: Zustand `S`, `DB` (IndexedDB), Rendering aller Ansichten, Erfassen/Bearbeiten, Katalogsuche, echtes Regal (Montana-Würfel), Tabelle mit Filtern/Sortierung, Import/Export, Einfügen/Ziehen von Bildern |
| `app/reclog.js` | Erkennungsprotokoll: `recRun`, `recAi`, `recBook`, `recSearch` (Meta `recLog`, letzte 30 Läufe, nur Gerät, Schlüssel werden entfernt), Ansicht `openRecLog`. Katalogabfragen je Quelle über `catTrack` (app.js) – `searchBooks(q, log)`, `lookupIsbn(isbn, log)`, `matchItem(it, log)`; KI-Anfragen über `aiRequest` (shelfscan.js) |
| `evalrun/eval.spec.js` | `npm run eval` (eigene Konfiguration `playwright.eval.config.js`, echtes Internet): wertet Fotos in `eval/` (nicht im Repo) mit `recognizeShelf` aus |
| `app/attachments.js` | Weitere Bilder, Dateien (E-Books/PDF), Widmung/Signatur, Anhänge in Sicherungen |
| `app/shelfscan.js` | Fach-Foto einlesen (Anthropic-API, Claude-Chat-Brücke), Katalogabgleich (`matchItem`, `autoChoice`, `resolveCollisions`, `assessScan` mit Texten `SCAN_WORDS`), Prüfliste `scanReview` (mit Foto oder ohne – siehe `titlelist.js`), neues Buch `bookFromItem`, Übernahme ins Fach `importScan`; Cover per KI |
| `app/spineread.js` | Fach-Foto zweistufig: Übersicht `ovParams`/`ovToScan` (Haiku 5.5, Lage, `quad`), Rücken lesen `readSpines`/`readParams` (Gruppen à 8, je Rücken aus dem Originalfoto `spineCanvas`, waagerecht, ≤1200 px), strukturierte Ausgabe (`output_config.format`, kein erzwungenes `tool_choice` – Opus/Sonnet 5.5 lehnen es ab), `aiScanShelf2`, Kosten `shelfCostCents`, unsichere genauer lesen `rereadUnsure` (API oder Chat-Collage `spineCollages`). Sammelauftrag in zwei Runden (`kind` "ov"/"read" in `aiBatches`) |
| `app/judge.js` | Claude wählt den Katalogtreffer: `judgeScan` (aus `matchScanItems`/`rematchItems`), `judgeItems` (Gruppen à 4, Rücken ≤800 px + Kandidaten-Cover 256 px), `applyJudge` (automatisch nur bei „high“ und passendem Band, sonst `it.suggest`), `clearJudge` nach neuer Suche; optionale Websuche `webSearchItems` (ISBN immer über `lookupIsbn` bestätigt). Läuft direkt, nicht im Sammelauftrag. Schalter localStorage `aiJudge` (Standard an), `aiWebSearch` (Standard aus), `judgeSettingsBox` |
| `app/titlelist.js` | „📋 Titelliste einfügen“: `parseTitleList` (Freitext, Tabellen mit/ohne Kopfzeile, eigener CSV-Export), Vorschau, Suche über `matchItem`, Prüfliste über `scanReview` ohne Foto, `tlImport`; angefangener Lauf im Meta-Eintrag `titleListRun` (nur Gerät, nicht in Sicherung/Abgleich), Weitermachen `resumeTitleList` |
| `app/batchscan.js` | Viele Fach-Fotos auf einmal erkennen: Sammelauftrag (Anthropic Message Batches, localStorage `aiBatches`), Abholen `checkBatches`, Ausweichweg einzeln, „der Reihe nach prüfen“ (`S.reviewChain`, `nextReview`) |
| `app/autobackup.js` | Automatische Sicherung in einen lokalen Ordner (File System Access API), Wiederherstellen |
| `app/coverfinder.js` | Cover nachtragen (sichere Treffer automatisch, sonst Nachfrage), Pseudo-Cover-Prüfung, Google-Bildersuche |
| `app/sync.js` | Optionaler Abgleich mit eigenem CouchDB-Server (eigene schlanke Umsetzung über die CouchDB-REST-API, kein PouchDB) |
| `app/shelfphotos.js` | Gespeicherte Fach-Fotos: `savePhoto`, Übersicht `openPhotoInbox`, Weitermachen nach Neustart (`scanPending`), Empfang über „Teilen“ (Service Worker → Cache `share-inbox` → `?share=`) |
| `app/duplicates.js` | Dubletten prüfen: Zusammenführen (`mergeBooks`), „verschiedene Bücher“ (`markDistinct`, Feld `notDup`). Erkennung `dupGroups` steht in `app.js` |
| `app/webtake.js` | Bücher aus dem Web übernehmen: `isbnsIn`, `bookFromWeb` (ISBN/Link/Text → ISBN, Datensatz oder Suchbegriff), `takeFromWeb`, Feld `webTakeField`, Zwischenablage-Angebot nach „Im Internet suchen“; „Teilen“ von Buchseiten landet hier |
| `app/perspective.js` | Perspektive entzerren: `homography`, `validQuad`, `quadsFromAnswer` (`cover_quad`/`spine_quad` aus der Cover-Erkennung), `warpQuad`, Ecken-Editor `quadEditor` („✂ Zuschneiden“) |
| `app/stackscan.js` | „📚 Stapel erfassen“: Kamera bleibt offen (`openStackCapture`, Barcode über `barcodeLoop` aus `app.js`), Einträge im Store `stack` (`putStackEntry`/`patchStackEntry`/`dropStackEntry`), Hintergrundsuche `stackWork`, Erkennung ohne Barcode per Sammelauftrag (`kind:"stack"` in `aiBatches`, Ergebnis über `stackRecognized`) oder Claude-Chat-Brücke, Prüfliste `openStackReview`, `importStack`; Vorgaben (localStorage `capturePreset`, nur Gerät): `capturePreset`, `applyPreset`, `placePresetBooks`, `presetBarEl`, `presetDialog` – auch von `openAdd`/`openReview` genutzt |
| `app/sw.js` | Service Worker (offline) |
| `tests/` | Playwright-Tests, `helpers.js` sperrt das Internet und bildet Kataloge/KI nach |
| `docs/ANLEITUNG.md` | Bedienungsanleitung für Nutzer |

Wichtig: Alle Skripte teilen sich den globalen Gültigkeitsbereich (keine Module). Was beim **ersten Rendern** gebraucht wird
(z. B. `needsCover`), muss in `app.js` stehen – die anderen Dateien laden danach.

Kataloge: alle Abfragen über `catFetch` (Zwischenspeicher 30 Min., DNB einzeln nacheinander, Pause nach 429/403: DNB 10 Min., Google 1 Std. + Hinweis `googleQuotaHint`). Erkannte Bücher suchen gezielt mit `searchFields` (Titel-/Personen-Index, schrittweise lockerer, Verlagsnummer), freie Suche `searchBooks`. K10plus: `k10Query`/`fromK10` (MARC wie DNB, nur Textmaterial). Startroutinen in Zusatzdateien warten auf `S.loaded` **und** `document.readyState !== "loading"`.

Zentrale Funktionen: `putBook`, `patchBook`, `readsOf`, `inStock`/`isWish`/`isGone`, `needsCover`, `buildBackup`, `importData`,
`locationOf`/`placeBook`/`unshelve`/`saveShelves`, `renderAll`, `openDetail(id, edit)`, `findCoverFor`, `coverRun`, `runAutoBackup`.

Abgleich (`sync.js`): Server-Dokumente `book:<id>` = `{type:"book", updatedAt, book:{…Felder ohne Blobs}, _attachments}` mit Anhängen
`cover`, `spine`, `img-<id>`, `file-<id>`; Löschung = `{type:"book", updatedAt, deletedAt}`; Regal = `meta:shelves`;
Fach-Fotos = `photo:<id>` `{type:"photo", updatedAt, photo:{…ohne blob}, _attachments:{image}}` (gelöscht: `deletedAt`, ohne Bild – lokal als Grabstein).
Fach-Foto-Datensatz: `{id, createdAt, updatedAt, fachKey, blob, w, h, scan?, scanAt?, review?, doneAt?, deletedAt?}` (`scan` aus der zweistufigen Erkennung hat zusätzlich `two_stage`, je Rücken optional `quad`, `books_in_image`, `spine_problem`, `read_error`; `review` = gemerkter Stand der Prüfliste `{at, fachKey, opts, items}`, über `photoReviewSave`; beim Übernehmen `null`); ändern nur über `putPhoto`/`patchPhoto`. Neuere `updatedAt` gewinnt.
Serveradresse immer über `syNormUrl` (Port/Pfad erlaubt – mehrere Anwendungen über Tailscale auf einem PC; `syStateKey` darf sich für alte Adressen nicht ändern).
Lokaler Stand in Meta `syncConf` (Zugang) und `syncState` (`since`, je Dokument `rev`/`upd`/Anhang-Digests). Änderungen an Büchern
immer über `putBook`/`patchBook`/`removeBook`/`saveShelves` – die rufen `dataChanged()` und lösen Sicherung und Abgleich aus.
Das Server-Format wie das Sicherungsformat nur **additiv** ändern (ältere App-Versionen auf anderen Geräten müssen mitlesen können).

Blätter (`sheet()`): am Handy schließt nur ✕, ein Blatt mit `guard` wird nie still ersetzt (`sheetStack`), Zurück-Taste über `popstate`. Wer ein offenes Blatt wiederverwendet (`openSheet || sheet()`), setzt `sh.redraw = null`. Hintergrund-Aktionen öffnen kein Blatt über einem offenen (`sh.webTake` erlaubt das Zwischenablage-Angebot). Entwurf „Prüfen & speichern“ in Meta `reviewDraft`, Hinweisleisten über `resumeBar`.

Echtes Regal neu zeichnen nur über `renderWall` – `wallViewSave`/`wallViewRestore` halten Rollposition und das zuletzt angetippte Fach fest.
Gesamtansicht (`S.overview`, localStorage `wallOverview`) zeigt alle Wände; Zoom stufenlos über `setWallZoom` (`S.zoom` bzw. `S.ovZoom`).
Bücherliste eingeklappt `S.sideClosed` (localStorage `wallSideClosed`), Großansicht `S.wallBig` (`wallBig`, ganze Fensterbreite); Wände tauschen `moveWall`.
Buchrücken: optionales Feld `spine.maxText` (Rückentitel maximiert, `maxFontPx`).

Regal-Modell (`S.shelves`): `walls[] → columns[] → modules[]` mit `type` `"6112"` (2 Fächer, 69,6×35,4 cm), `"1112"` (4 Fächer, 69,6×69,6 cm)
oder `"gap"`, `orient` `"h"|"v"`; Fächer `L/R`, `T/B` (hochkant), `TL/TR/BL/BR`; je Fach Ebenen `fachs` (vorne), `back`, `top`; liegende Bücher in `lying`.

## Arbeitsweise

- **Zweige:** Entwickelt wird auf `develop` (oder einem Zweig davon). `main` ist die Produktion und bekommt Änderungen nur per
  Pull Request `develop → main`, nachdem die Tests grün sind. Nie direkt auf `main` committen oder pushen.

- **Vor jedem Abschluss `npm test` ausführen** – alle Tests müssen grün sein. Neue Funktionen bekommen einen Test in `tests/`.
- Änderungen an Dateien in `app/`: **`VERSION` in `app/sw.js` erhöhen** (z. B. `"v18"` → `"v19"`), sonst sehen installierte Apps die Änderung nicht.
  Neue Dateien zusätzlich in `FILES` in `sw.js` eintragen (ein Test prüft das).
- Bei Datenänderungen immer einen Test ergänzen, der eine **alte** Sicherung bzw. einen alten Datensatz lädt (siehe `tests/compat.spec.js`).
- Tests nutzen nie das echte Internet. Neue externe Dienste in `tests/helpers.js` nachbilden.
- Commit-Nachrichten auf Deutsch, kurz und beschreibend.
