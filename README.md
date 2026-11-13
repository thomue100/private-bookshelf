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

| Zweig | Zweck | Adresse (Vercel) |
|---|---|---|
| `main` | **Produktion** – die App, die du im Alltag nutzt | `https://<projekt>.vercel.app` |
| `develop` | **Entwicklung** – hier entstehen neue Funktionen | `https://<projekt>-git-develop-<konto>.vercel.app` |

Ablauf:
1. In IntelliJ auf `develop` arbeiten (`git switch develop`), mit Claude Code ändern, `npm test`, committen, pushen.
2. Die Testversion unter der `develop`-Adresse ausprobieren. Sie hat ihren **eigenen Speicher** – deine echten Bücher sind dort nicht
   (bei Bedarf eine Sicherung importieren oder den Abgleich mit einer **eigenen Test-Datenbank**, z. B. `buecherregal-test`, einschalten).
3. Passt alles: auf GitHub **Pull request** `develop → main` öffnen. GitHub Actions lässt die Tests laufen; wenn sie grün sind, **Merge**.
   Vercel veröffentlicht `main` dann automatisch.
4. Nie direkt auf `main` committen. Technisch absichern lässt sich das mit einer **Branch-Schutzregel** (Settings → Branches bzw. Rules):
   bei öffentlichen Repositories kostenlos, bei privaten nur in bezahlten GitHub-Plänen.
5. Nach dem Merge zeigt die installierte App beim nächsten Öffnen den Hinweis **„Neue Version der App ist da“** – „Jetzt aktualisieren“ lädt sie neu.

## Veröffentlichen (Hosting)

Die Kamera funktioniert nur über **https**. Empfohlen: **Vercel** – kostenlos (Hobby-Tarif), mit öffentlichem wie privatem Repository.

1. Auf https://vercel.com mit dem GitHub-Konto ein kostenloses Konto anlegen → **Add New… → Project**.
2. Bei GitHub den Zugriff erlauben und `private-bookshelf` **importieren**.
3. Einstellungen:
   - Framework Preset **Other**
   - Root Directory **`app`** (über **Edit** auswählen)
   - Build Command **leer lassen**
   - Produktionszweig **`main`** (Vercel nimmt den Standardzweig des Repositorys; prüfen bzw. ändern unter Settings → Environments → Production)
4. **Deploy** – nach ca. einer Minute ist die App unter `https://<projekt>.vercel.app` erreichbar. Jeder Push auf `main` aktualisiert sie.
5. Andere Zweige veröffentlicht Vercel automatisch als Vorschau, `develop` unter
   `https://<projekt>-git-develop-<konto>.vercel.app` (`<konto>` ist dein Vercel-Kontoname; die genaue Adresse steht unter **Deployments**).

**Vorschauen sind geschützt:** Vercel schaltet für Vorschau-Adressen standardmäßig die **Deployment Protection** („Vercel Authentication“) ein.
Die `develop`-Adresse öffnet sich dann nur, wenn du im selben Browser bei Vercel angemeldet bist – auch am Handy. Wer das nicht möchte,
stellt es unter **Settings → Deployment Protection** ab. Die Produktionsadresse `https://<projekt>.vercel.app` ist davon nicht betroffen.

**Was ist öffentlich?** Die **Produktionsadresse** der App ist für jeden aufrufbar – und das Repository ist es auch, solange es auf GitHub
als *Public* eingestellt ist (umstellen: Settings → General → Danger Zone → *Change visibility*; Vercel funktioniert in beiden Fällen).
Beides ist unkritisch: Dort liegt nur das Programm. Deine Bücher stehen nur im Browser deiner Geräte und – falls eingerichtet – in der
CouchDB auf deinem PC; Zugangsdaten und KI-Schlüssel gehören nie ins Repository.

Alternativen: **GitHub Pages** bei öffentlichem Repository (Settings → Pages → Branch `main`, Ordner – dann aber den
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
- Abgleich (`app/sync.js`): Tests in `tests/sync.spec.js` laufen gegen einen nachgebildeten CouchDB-Server.
  **Gegen den echten Server** (ab und zu, z. B. vor einem Pull Request mit Änderungen am Abgleich) – mit der eigenen
  Test-Datenbank `buecherregal-test`, in der der App-Benutzer Mitglied ist (in Fauxton wie `buecherregal` anlegen, Teil 1, Schritte 5 und 7):
  ```powershell
  $env:COUCH_REAL_URL="https://DEIN-PC.tailXXXX.ts.net"; $env:COUCH_REAL_DB="buecherregal-test"
  $env:COUCH_REAL_USER="buecher"; $env:COUCH_REAL_PASS="…"
  npx playwright test sync-real
  ```
  Der Test prüft die ganze Kette (Browser → Tailscale-https → CORS → CouchDB) mit zwei „Geräten“, leert die Test-Datenbank vorher
  und nachher und **verweigert jede Datenbank ohne „test“ im Namen** – die echten Bücher bleiben unberührt. Ohne `COUCH_REAL_URL`
  wird er übersprungen (auch bei GitHub).
