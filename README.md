# private-bookshelf – Mein Bücherregal

Private Bücherverwaltung als Web-App (PWA) für Handy und PC:
Bücher per Barcode, Cover-Foto, Fach-Foto oder von Hand erfassen, im Regal mit Covern stöbern, Lesestatus, Bewertung und
Notizen pflegen, ein **echtes Regal** aus Montana-Würfeln nachbauen und alles in einer Tabelle verwalten.

**Die Bücher bleiben bei dir.** Es gibt kein Konto und keine Cloud. Jedes Gerät speichert die Bibliothek im Browser und funktioniert auch offline.
Handy und PC gleichen sich ab
- **automatisch über den eigenen PC** (CouchDB + Tailscale, optional) – Einrichtung: [`docs/ABGLEICH-EINRICHTEN.md`](docs/ABGLEICH-EINRICHTEN.md),
- oder von Hand per Sicherungsdatei (Menü ⋯ → Sicherung exportieren / importieren).

Die Bedienungsanleitung steht in [`docs/ANLEITUNG.md`](docs/ANLEITUNG.md).

## Projektaufbau

```
app/          die App selbst – genau dieser Ordner wird veröffentlicht (kein Build-Schritt)
tests/        automatische Tests (Playwright), laufen ohne Internet
docs/         Anleitungen (Bedienung, Abgleich einrichten)
CLAUDE.md     Regeln für Claude Code (Datenkompatibilität, Service-Worker-Version, Tests)
```

## Einrichten in IntelliJ

Voraussetzungen: [Node.js](https://nodejs.org) ab Version 20, Git, IntelliJ IDEA (Ultimate oder Community mit JavaScript-Plugin).

1. **File → New → Project from Version Control**, URL `https://github.com/thomue100/private-bookshelf.git`.
2. Im Terminal von IntelliJ:
   ```bash
   npm install
   npx playwright install chromium   # einmalig: Test-Browser herunterladen
   ```
3. App lokal starten: `npm start` → http://localhost:8765
4. Tests: `npm test` (alle), `npm run test:ui` (mit Oberfläche zum Durchklicken), `npm run test:headed` (sichtbarer Browser).
   Einen bereits installierten Chrome nutzen: `CHROME_PATH=/pfad/zu/chrome npm test`.

### Mit Claude Code arbeiten

Claude Code im Projektordner starten (Terminal in IntelliJ, oder über das Claude-Code-Plugin für JetBrains).
Claude liest automatisch [`CLAUDE.md`](CLAUDE.md) und hält sich an die Regeln – vor allem: vorhandene Bücher und alte Sicherungen
müssen weiter funktionieren, und vor dem Abschluss läuft `npm test`. Beispiel-Aufträge:

- „Füge in der Detailseite ein Feld *Auflage* hinzu, mit Spalte in der Tabelle und im CSV.“
- „Die Tabelle soll sich auf dem Handy als Liste darstellen.“

Bei jedem Push prüft GitHub die Tests automatisch (Reiter **Actions**).

## Zweige: Entwicklung und Produktion

| Zweig | Zweck | Adresse (Cloudflare Pages) |
|---|---|---|
| `main` | **Produktion** – die App, die du im Alltag nutzt | `https://<projekt>.pages.dev` |
| `develop` | **Entwicklung** – hier entstehen neue Funktionen | `https://develop.<projekt>.pages.dev` |

Ablauf:
1. In IntelliJ auf `develop` arbeiten (`git switch develop`), mit Claude Code ändern, `npm test`, committen, pushen.
2. Die Testversion unter der `develop`-Adresse ausprobieren. Sie hat ihren **eigenen Speicher** – deine echten Bücher sind dort nicht
   (bei Bedarf eine Sicherung importieren oder den Abgleich mit einer **eigenen Test-Datenbank**, z. B. `buecherregal-test`, einschalten).
3. Passt alles: auf GitHub **Pull request** `develop → main` öffnen. GitHub Actions lässt die Tests laufen; wenn sie grün sind, **Merge**.
   Cloudflare veröffentlicht `main` dann automatisch.
4. Nie direkt auf `main` committen. (Ein technischer Schutz dafür ist bei privaten Repositories nur in bezahlten GitHub-Plänen verfügbar.)

## Veröffentlichen (Hosting)

Die Kamera funktioniert nur über **https**. Empfohlen: **Cloudflare Pages** – kostenlos und funktioniert auch mit privatem Repository.

1. Auf https://dash.cloudflare.com ein kostenloses Konto anlegen → **Workers & Pages → Erstellen → Pages → Mit Git verbinden**.
2. GitHub verbinden und `private-bookshelf` auswählen.
3. Einstellungen: Framework **Keine**, Build-Befehl **leer lassen**, Ausgabeverzeichnis **`app`**, Produktionszweig `main`.
4. Speichern – nach ca. einer Minute ist die App unter `https://<projektname>.pages.dev` erreichbar. Jeder Push auf `main` aktualisiert sie.
5. Andere Zweige veröffentlicht Cloudflare automatisch als Vorschau, `develop` unter `https://develop.<projektname>.pages.dev`
   (Einstellung „Preview deployments“ auf „All non-production branches“ lassen).

Hinweis: Das Repository bleibt privat, die **Webadresse** der App ist aber öffentlich aufrufbar. Das ist unkritisch, weil dort nur das
leere Programm liegt – deine Bücher stehen nur im Browser deiner Geräte. Wer die Adresse zusätzlich schützen möchte, kann in Cloudflare
„Zero Trust → Access“ davorschalten.

Alternativen: Repository öffentlich machen und **GitHub Pages** nutzen (Settings → Pages → Branch `main`, Ordner – dann aber den
Inhalt von `app/` ins Wurzelverzeichnis bzw. einen `docs/`-Ordner legen), oder GitHub Pages mit einem bezahlten GitHub-Plan für private Repositories.

### Wichtig beim Umzug auf eine neue Adresse

Die Bücher hängen an der **Webadresse**, unter der die App läuft. Wenn du die App bisher unter einer anderen Adresse benutzt hast:

1. In der **alten** App: Menü ⋯ → **Sicherung exportieren** (mit Bildern und Dateien).
2. Die **neue** Adresse öffnen (und ggf. neu als App installieren): Menü ⋯ → **Sicherung importieren**.
3. Prüfen, ob alles da ist – erst dann die alte App vom Handy entfernen.

## Weiterentwicklung – Regeln in Kürze

- Datenbank (IndexedDB `buecherregal` v2) und Sicherungsformat (Version 1 und 2) nur **additiv** ändern.
- Bei jeder Änderung in `app/` die `VERSION` in `app/sw.js` erhöhen, damit installierte Apps aktualisieren.
- Neue Funktion → neuer Test in `tests/`.
- Abgleich (`app/sync.js`): Tests in `tests/sync.spec.js` laufen gegen einen nachgebildeten CouchDB-Server. Gegen einen echten Server:
  `COUCH_REAL_URL=http://localhost:5984 COUCH_REAL_USER=admin COUCH_REAL_PASS=… npx playwright test sync-real`
