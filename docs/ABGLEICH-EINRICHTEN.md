# Abgleich über den eigenen PC einrichten (CouchDB + Tailscale)

Damit gleichen sich Handy und PC automatisch ab. Die Bücher liegen danach an drei Stellen: im Browser am Handy, im Browser am PC
und in der Datenbank **auf deinem PC**. Nichts davon liegt in einer Cloud.

So funktioniert es im Alltag:
- Das Handy speichert alles sofort selbst. Ohne Verbindung geht nichts verloren.
- Sobald Handy und PC sich erreichen (PC an, Tailscale an), gleichen sie sich innerhalb weniger Sekunden ab.
- Hast du dasselbe Buch auf beiden Geräten geändert, gewinnt die neuere Änderung.

Zeitbedarf: einmalig etwa 30–45 Minuten. Du brauchst den Windows-PC und dein Handy (Android oder iPhone).

---

## Teil 1 – CouchDB auf dem PC installieren

1. Auf https://couchdb.apache.org auf **Download** gehen und das Windows-Installationsprogramm (`.msi`, 64 bit) herunterladen.
2. Installieren. Im Verlauf fragt das Programm nach einem **Admin-Benutzer und Passwort**, z. B. `admin` und ein sicheres Passwort.
   Gut aufschreiben – das ist der Hauptschlüssel für die Datenbank.
   Den Haken **„Install as Windows service“** gesetzt lassen: Dann startet CouchDB automatisch mit dem PC und läuft unsichtbar im Hintergrund.
3. Im Browser **http://127.0.0.1:5984/_utils** öffnen. Das ist „Fauxton“, die Verwaltungsoberfläche von CouchDB. Mit dem Admin anmelden.
4. Links auf **Setup** (Schraubenschlüssel) → **Configure a Single Node**.
   - Admin-Benutzer/Passwort wie oben eingeben.
   - Bei **Bind address** `127.0.0.1` eintragen (nicht `0.0.0.0`). So ist die Datenbank im Heimnetz nicht direkt erreichbar –
     den Zugang für dein Handy übernimmt gleich Tailscale.
   - **Configure Node** klicken.

### Datenbank und App-Benutzer anlegen

5. Links **Databases** → oben **Create Database** → Name `buecherregal`, „Non-partitioned“ → **Create**.
6. Einen eigenen Benutzer für die App anlegen (damit das Admin-Passwort nicht auf dem Handy liegt):
   **Databases** → Datenbank **`_users`** öffnen → **Create Document** und den Inhalt so ersetzen
   (Passwort selbst wählen, die Anführungszeichen bleiben stehen):
   ```json
   {
     "_id": "org.couchdb.user:buecher",
     "name": "buecher",
     "type": "user",
     "roles": [],
     "password": "HIER-EIN-EIGENES-PASSWORT"
   }
   ```
   → **Create Document**. (CouchDB speichert das Passwort danach verschlüsselt.)
7. Dem Benutzer die Datenbank erlauben: **Databases** → `buecherregal` → links **Permissions** →
   unter **Members** bei **Users** `buecher` eintragen → **Add User**.
   Neue Datenbanken sind in CouchDB 3 zunächst nur für Admins offen – ohne diesen Schritt meldet die App „Kein Zugriff“.

### Zugriff aus der App erlauben (CORS)

8. Links das Zahnrad **Configuration** → Reiter **CORS** → **Enable CORS**.
9. **Restrict to specific domains** wählen und die Adressen eintragen, unter denen du die App öffnest – jeweils genau so, ohne `/` am Ende:
   - `https://DEIN-PROJEKT.vercel.app` (die App im Alltag)
   - `https://DEIN-PROJEKT-git-develop-DEIN-KONTO.vercel.app` (die Testversion; die genaue Adresse steht bei Vercel unter **Deployments**)
   - `http://localhost:8765` (wenn du am PC mit `npm start` entwickelst)

## Teil 2 – Tailscale: Handy und PC privat verbinden

Tailscale ist ein kostenloses privates Netz nur zwischen deinen eigenen Geräten. Das Handy erreicht den PC damit auch unterwegs –
der PC wird dabei **nicht** im Internet sichtbar. Außerdem liefert Tailscale die https-Verschlüsselung, die die App braucht.

1. **PC:** https://tailscale.com/download → Windows herunterladen, installieren und anmelden (z. B. mit deinem Microsoft- oder Google-Konto).
2. **Handy:** App **„Tailscale“** aus dem Play Store bzw. App Store installieren und mit **demselben Konto** anmelden. Die Verbindung einschalten.
3. **PC:** Eingabeaufforderung oder PowerShell öffnen und eingeben:
   ```
   tailscale serve --bg 5984
   ```
   Beim ersten Mal erscheint ein Link, über den du „Serve“ und HTTPS-Zertifikate für dein Tailscale-Netz einschaltest – Link öffnen,
   bestätigen, den Befehl noch einmal eingeben. Danach zeigt Tailscale die Adresse an, etwa:
   ```
   Available within your tailnet:
   https://mein-pc.tail1234.ts.net
   ```
   Diese Adresse aufschreiben. Durch `--bg` bleibt die Freigabe auch nach einem Neustart bestehen.
4. Test am Handy (Tailscale eingeschaltet): die Adresse im Browser öffnen. Es erscheint eine kurze Zeile mit `"couchdb":"Welcome"` – dann passt alles.

## Teil 3 – In der App einschalten

**Reihenfolge ist wichtig:** zuerst das Gerät, auf dem deine Bücher vollständig sind.

1. **PC**, die App unter ihrer festen Adresse (z. B. `https://DEIN-PROJEKT.vercel.app`) öffnen.
   Falls sie dort noch leer ist: erst **Menü ⋯ → Sicherung importieren** mit deiner aktuellen Sicherungsdatei.
2. **Menü ⋯ → 🔄 Abgleich mit eigenem Server …**
   - Serveradresse: `https://mein-pc.tail1234.ts.net`
   - Datenbank: `buecherregal`
   - Benutzer: `buecher`, Passwort: wie in Teil 1, Schritt 6
   - **Verbindung prüfen & einschalten**. Beim ersten Mal werden alle Bücher samt Covern hochgeladen – das kann ein paar Minuten dauern.
3. **Handy**: App öffnen (am besten als App auf dem Startbildschirm installiert), dieselben Angaben eintragen, einschalten.
   Die Bücher erscheinen nach und nach.

Oben neben dem Menü zeigt ein kleines **⟳** den Abgleich an: dreht sich = gleicht gerade ab, rot = Problem (antippen für Details).

**iPhone:** Die App bitte über Safari → Teilen → **Zum Home-Bildschirm** installieren und von dort öffnen. Safari räumt Daten von
Webseiten, die länger nicht besucht wurden, sonst unter Umständen auf. Mit dem Abgleich liegt aber ohnehin eine Kopie auf dem PC.

## Wenn etwas nicht klappt

| Meldung | Ursache und Lösung |
|---|---|
| Server nicht erreichbar | PC aus? Tailscale auf beiden Geräten an? `tailscale serve` eingerichtet? Steht die App-Adresse genau so bei CORS (Teil 1, Schritt 9)? |
| Benutzername oder Passwort stimmt nicht | Benutzer/Passwort aus Teil 1, Schritt 6 prüfen |
| Kein Zugriff auf die Datenbank | Teil 1, Schritt 7: `buecher` als Member eintragen |
| Die Datenbank gibt es noch nicht | Teil 1, Schritt 5: `buecherregal` anlegen (Name genau so) |

Der Abgleich ersetzt keine Sicherung: Die **automatische Sicherung in einen Ordner** (Menü ⋯ → 💾) bzw. ab und zu
„Sicherung exportieren“ bleiben sinnvoll – z. B. auf einen USB-Stick.

## Ausschalten

Menü ⋯ → 🔄 Abgleich → **Ausschalten**. Die Bücher bleiben auf dem Gerät; die App arbeitet wie vorher allein weiter.
