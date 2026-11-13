# CLAUDE.md – Regeln für die Arbeit an „private-bookshelf“

Persönliche Bücherverwaltung als PWA („Mein Bücherregal“). Bücher werden am Handy oder PC erfasst
(Barcode, Cover-Foto, Fach-Foto, von Hand) und bleiben **ausschließlich im Browser des Geräts** (IndexedDB).
Abgleich zwischen Geräten nur per Sicherungsdatei (Export/Import) oder automatischer Sicherung in einen lokalen Ordner.

## Grundsätze (nicht verhandelbar)

1. **Vorhandene Daten müssen weiter funktionieren.** Die Nutzerin/der Nutzer hat bereits eine Buchdatenbank.
   - IndexedDB `buecherregal` Version 2 mit Stores `books` (keyPath `id`), `meta` (keyPath `key`), `blobs` (keyPath `id`, Index `bookId`).
     Schema nur **additiv** erweitern (neuer Store/Index → Version erhöhen, `onupgradeneeded` darf nichts löschen oder umbauen).
   - Neue Buchfelder sind **optional**. Alter Datensatz ohne das Feld muss überall funktionieren (Anzeige, Tabelle, CSV, Filter, Sicherung).
     Felder nie umbenennen oder umdeuten; alte Felder beim Lesen übersetzen (Beispiel: `startedAt`/`finishedAt` → `readsOf(b)`).
   - **Sicherungen Version 1 und 2 müssen importierbar bleiben** (`importData`). Format: `{app:"buecherregal", version:2, books, deleted, shelves}`;
     Cover als `coverData` (data-URL), Buchrücken-Bild als `spine.imageData`, Anhänge optional mit `data`.
     Abgleich: neuere `updatedAt` gewinnt, Löschungen über `deleted` (Grabsteine).
2. **Keine Cloud für Buchdaten.** Nichts an eigene Server schicken. Erlaubt sind nur Abfragen an Kataloge/Suchen
   (Google Books, DNB, Open Library, Google-Bildersuche) und – nur wenn eingerichtet – die Anthropic-API mit dem Schlüssel des Nutzers.
3. **Läuft ohne Claude.** Alle KI-Funktionen sind optional; es gibt immer einen Weg ohne (OCR, Hand-Eingabe, Claude-Chat-Brücke).
4. **Kein Build-Schritt, keine Frameworks.** Reines HTML/CSS/JavaScript in `app/`, direkt auslieferbar. Externe Bibliotheken nur per CDN
   und nur bei Bedarf nachgeladen (Tesseract, ZXing).
5. **Oberfläche auf Deutsch**, freundlich und ohne Fachjargon. Muss am Handy (390 px breit) und am PC benutzbar sein.

## Aufbau

| Datei | Inhalt |
|---|---|
| `app/index.html` | Gerüst, Navigation (`#regal`, `#wand`, `#wunsch`, `#verwaltung`), Skripte in fester Reihenfolge (alle `defer`) |
| `app/app.js` | Kern: Zustand `S`, `DB` (IndexedDB), Rendering aller Ansichten, Erfassen/Bearbeiten, Katalogsuche, echtes Regal (Montana-Würfel), Tabelle mit Filtern/Sortierung, Import/Export, Einfügen/Ziehen von Bildern |
| `app/attachments.js` | Weitere Bilder, Dateien (E-Books/PDF), Widmung/Signatur, Anhänge in Sicherungen |
| `app/shelfscan.js` | Fach-Foto einlesen (Anthropic-API, Claude-Chat-Brücke, OCR), Prüfliste, Übernahme ins Fach; Cover per KI |
| `app/autobackup.js` | Automatische Sicherung in einen lokalen Ordner (File System Access API), Wiederherstellen |
| `app/coverfinder.js` | Cover nachtragen (sichere Treffer automatisch, sonst Nachfrage), Pseudo-Cover-Prüfung, Google-Bildersuche |
| `app/sw.js` | Service Worker (offline) |
| `tests/` | Playwright-Tests, `helpers.js` sperrt das Internet und bildet Kataloge/KI nach |
| `docs/ANLEITUNG.md` | Bedienungsanleitung für Nutzer |

Wichtig: Alle Skripte teilen sich den globalen Gültigkeitsbereich (keine Module). Was beim **ersten Rendern** gebraucht wird
(z. B. `needsCover`), muss in `app.js` stehen – die anderen Dateien laden danach.

Zentrale Funktionen: `putBook`, `patchBook`, `readsOf`, `inStock`/`isWish`/`isGone`, `needsCover`, `buildBackup`, `importData`,
`locationOf`/`placeBook`/`unshelve`/`saveShelves`, `renderAll`, `openDetail(id, edit)`, `findCoverFor`, `coverRun`, `runAutoBackup`.

Regal-Modell (`S.shelves`): `walls[] → columns[] → modules[]` mit `type` `"6112"` (2 Fächer, 69,6×35,4 cm), `"1112"` (4 Fächer, 69,6×69,6 cm)
oder `"gap"`, `orient` `"h"|"v"`; Fächer `L/R`, `T/B` (hochkant), `TL/TR/BL/BR`; je Fach Ebenen `fachs` (vorne), `back`, `top`; liegende Bücher in `lying`.

## Arbeitsweise

- **Vor jedem Abschluss `npm test` ausführen** – alle Tests müssen grün sein. Neue Funktionen bekommen einen Test in `tests/`.
- Änderungen an Dateien in `app/`: **`VERSION` in `app/sw.js` erhöhen** (z. B. `"v18"` → `"v19"`), sonst sehen installierte Apps die Änderung nicht.
  Neue Dateien zusätzlich in `FILES` in `sw.js` eintragen (ein Test prüft das).
- Bei Datenänderungen immer einen Test ergänzen, der eine **alte** Sicherung bzw. einen alten Datensatz lädt (siehe `tests/compat.spec.js`).
- Tests nutzen nie das echte Internet. Neue externe Dienste in `tests/helpers.js` nachbilden.
- Commit-Nachrichten auf Deutsch, kurz und beschreibend.
