# Mein Bücherregal – Anleitung

Eine eigenständige Web-App für deine private Bibliothek. Sie läuft im Browser auf Handy und PC, braucht kein Konto, keinen Server und keine KI. Alle Daten bleiben auf dem jeweiligen Gerät.

## 1. Einmalig ins Netz stellen (kostenlos, ca. 10 Minuten)

Damit die Kamera funktioniert, muss die App über **https** erreichbar sein.

> **Im GitHub-Projekt `private-bookshelf`** liegen die App-Dateien im Ordner `app/`. Dort wird über Vercel veröffentlicht – die Schritte stehen in der `README.md`. Die folgende Anleitung gilt, wenn du die App als ZIP-Paket weitergibst.

Am einfachsten geht das mit **GitHub Pages**:

1. Auf https://github.com ein kostenloses Konto anlegen.
2. Oben rechts **＋ → New repository**, Name z. B. `buecherregal`, auf **Public** lassen, **Create repository**.
3. Auf der neuen Seite **„uploading an existing file“** anklicken und **alle Dateien und den Ordner `icons`** aus diesem Paket hineinziehen (nicht den übergeordneten Ordner). **Commit changes**.
4. Im Repository **Settings → Pages**: unter „Branch“ `main` und `/ (root)` wählen, **Save**.
5. Nach 1–2 Minuten ist die App erreichbar unter
   `https://DEIN-NAME.github.io/buecherregal/`

Alternative: Netlify (https://app.netlify.com/drop) – Ordner hineinziehen, kostenloses Konto anlegen, damit die Adresse bestehen bleibt.

**Wichtig:** Die Daten hängen an der Adresse. Behalte also immer dieselbe Adresse.

## 2. Als App installieren

- **Android (Chrome):** Adresse öffnen → Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“.
- **iPhone (Safari):** Adresse öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**.
- **PC (Chrome/Edge):** Adresse öffnen → Installieren-Symbol rechts in der Adressleiste (optional, geht auch einfach als Lesezeichen).

## 3. Bücher erfassen

- **Weg A – Barcode:** „Barcode scannen“ → Kamera über den ISBN-Barcode halten. Die Buchdaten kommen von der Deutschen Nationalbibliothek (DNB), Google Books und Open Library.
- **Weg B – Cover-Foto:** Vorderseite fotografieren (oder am PC ein Bild wählen, hineinziehen oder mit Strg+V einfügen). Die App liest den Text vom Cover und zeigt passende Bücher zur Auswahl. Dein Foto kann als Cover dienen.
- Außerdem: Suche nach Titel/Autor, ISBN eintippen oder komplett von Hand eintragen.
- **Suche nach Titel/Autor:** Die Treffer zeigen jede Ausgabe einzeln (Verlag, Jahr, Seiten, ISBN). Aktuelle deutsche Ausgaben aus der DNB stehen oben, E-Books sind markiert.
- **Internetsuche:** Unter den Treffern, beim Bearbeiten und auf jeder Buchseite stehen Links zu Suchseiten. Welche, bestimmst du selbst: Menü ⋯ → „Suchseiten wählen“ (oder „⚙︎ anpassen“ neben den Links). Zur Auswahl stehen u. a. Google, ZVAB, SLUB Dresden, DNB-Katalog, booklooker, Thalia, Amazon, AbeBooks, Google Books und Open Library. Eigene Seiten (z. B. deine Stadtbibliothek) fügst du mit einer Such-Adresse hinzu, in der der Suchbegriff durch `{q}` ersetzt ist. ZVAB und booklooker suchen nach Titel + Autor (findet alle Ausgaben), die übrigen nach ISBN, falls vorhanden.

## Bücher bearbeiten

- Ein Klick auf ein Buch öffnet die **Ansicht**. Lesestatus und Sterne kannst du dort direkt umschalten.
- **✏️ Bearbeiten** öffnet alle Angaben: Cover (Foto, Datei, Drag & Drop, Strg+V, Online-Cover, entfernen), Lesestatus, Bewertung, Datumsangaben, Notizen und sämtliche Buchdaten.
- Änderungen werden erst mit **💾 Speichern** übernommen (am PC auch mit Strg+S). „Abbrechen“ oder Schließen fragt nach, wenn noch etwas ungespeichert ist.
- **🔎 Leere Felder online ergänzen** füllt nur leere Felder; **↻ Alles per ISBN neu laden** überschreibt die Buchdaten mit den Online-Daten zur ISBN (Notizen, Bewertung, Status bleiben). Beides wird erst beim Speichern übernommen.
- In der **Verwaltung** (Tabelle) öffnet ✏️ direkt den Bearbeiten-Modus. Änderungen direkt in den Tabellenzellen werden wie in Excel sofort gespeichert.
- „Speichern & nächstes“ ist praktisch, wenn du einen ganzen Stapel erfasst.

## Mehrfach gelesen

Unter „Gelesen (auch mehrfach)“ trägst du beliebig viele Lesedurchgänge ein – jeweils mit Anfang, Ende und optionaler Notiz („im Urlaub“, „Hörbuch“). Setzt du ein bereits gelesenes Buch wieder auf **Gerade dabei**, beginnt automatisch ein neuer Durchgang mit dem heutigen Datum; **Gelesen** schließt ihn ab. Auf der Buchseite steht dann z. B. „2× gelesen“ mit allen Zeiträumen, in der Tabelle die Spalte „Gelesen“.

## Hatte ich mal

Hast du ein Buch verschenkt, gespendet, verkauft, getauscht oder verloren, tippe auf der Buchseite **📦 Hatte ich mal …** (oder im Bearbeiten-Modus unter „Besitz“). Du wählst, was passiert ist, an wen es ging, wann – und kannst einen Kommentar schreiben. Das Buch:
- verschwindet aus dem normalen Regal und erscheint **ausgegraut in der Liste „Hatte ich mal“** unten in der Bücher-Ansicht (auf- und zuklappbar),
- wird aus dem echten Regal herausgenommen,
- behält alle Notizen, Bewertungen und Lesedaten.
„↩ Wieder in meinem Besitz“ macht es rückgängig. In der Verwaltung gibt es den Filter „📦 Hatte ich mal“. „Löschen“ entfernt ein Buch dagegen endgültig.

## Widmung, Signatur, weitere Bilder und Dateien

Im Bearbeiten-Modus eines Buches:
- **Widmung & Signatur:** „✍ Signiertes Exemplar“ ankreuzen, „Signiert von / Anlass“ und den Wortlaut der Widmung eintragen. In der Tabelle zeigt die Spalte „Extras“ das an; die Suche findet auch Widmungstexte.
- **Weitere Bilder:** beliebig viele Fotos (Widmung, Signatur, Rückseite, Zustand, Kaufbeleg …) mit Beschriftung – per Kamera, Datei oder Drag & Drop. Auf der Buchseite als Galerie, Antippen vergrößert.
- **Dateien:** E-Books (EPUB, MOBI …), PDFs, Hörbücher oder andere Dateien zum Buch. Auf der Buchseite „Öffnen“ (PDFs im Browser) oder ⬇ herunterladen.
- Alles wird erst mit „💾 Speichern“ übernommen.

Bilder und Dateien liegen in einem eigenen Speicher im Browser, damit die App auch mit großen PDFs schnell bleibt. Beim **Export** fragt die App, ob weitere Bilder und Dateien mit in die Sicherung sollen (große Dateien machen die Sicherung groß). Was du weglässt, bleibt beim Import auf dem anderen Gerät erhalten, wenn es dort schon vorhanden ist.

**Ältere Sicherungen** (aus allen bisherigen Versionen der App) lassen sich weiterhin importieren; vorhandene Bücher im Browser werden beim Update automatisch übernommen.

## Preis und heutiger Wert

Bei den Buchdaten gibt es **Preis (€)** und **Heutiger Wert (€)** (z. B. „12,90“). Beide erscheinen auf der Buchseite unter „Details“, als Spalten „Preis €“ und „Wert €“ in der Verwaltung (sortierbar, direkt bearbeitbar) und im CSV-Export.

## Reihe und Band

Bei den Buchdaten gibt es **Reihe** (mit Vorschlägen aus deinen bisherigen Reihen) und **Band-Nr.**. Die Deutsche Nationalbibliothek liefert die Reihe oft gleich mit; beim Fach-Foto werden z. B. dtv-Nummern als Reihe „dtv“ mit Bandnummer übernommen.
- In der Bücher-Ansicht: Auswahl **„Alle Reihen“** – zeigt nur diese Reihe, nach Band sortiert. Sortierung **„Reihe & Band“** sortiert alles so.
- Auf der Buchseite: „📚 Reihe · Band 3“ antippen zeigt alle Bände der Reihe.
- In der Verwaltung: Spalten „Reihe“ und „Band“ (sortierbar, direkt bearbeitbar).

## Wunschliste (getrennt vom Bestand)

Reiter **⭐ Wunschliste**: Bücher, die du noch nicht besitzt.
- **Hinzufügen:** dort „＋ Wunsch hinzufügen“ (alle Wege: Barcode, Cover, Suche, ISBN, von Hand). Beim Prüfen kannst du jederzeit zwischen „📚 In meinen Bestand“ und „⭐ Auf die Wunschliste“ wählen.
- **Getrennt:** Wünsche erscheinen nicht im Regal, nicht im echten Regal und zählen in keiner Bestandszahl mit. Die Suche im Regal weist nur darauf hin („Auch auf deiner Wunschliste: 1 Treffer“).
- **Gekauft?** Buch öffnen → **„✓ Gekauft – in den Bestand übernehmen“**. Erfasst du ein Buch, das auf der Wunschliste steht (oder taucht es auf einem Fach-Foto auf), fragt die App bzw. übernimmt es automatisch als gekauft – ohne Doppel.
- Die Wunschliste zeigt die Summe der eingetragenen Preise. In der Verwaltung gibt es den Filter „⭐ Wunschliste“; im Bearbeiten-Modus lässt sich unter „Besitz“ umschalten.

## Schlagworte

Im Bearbeiten-Modus (und beim Erfassen) unter den Buchdaten: Schlagwort eintippen und Enter drücken – bereits benutzte Schlagworte werden vorgeschlagen, Groß-/Kleinschreibung wird angeglichen. Mehrere auf einmal mit Komma.
- **Filtern:** Auswahl „Alle Schlagworte“ in der Bücher-Ansicht und in der Verwaltung; oder auf der Buchseite ein Schlagwort antippen.
- **Suchen:** Die normale Suche findet Schlagworte mit.
- **Tabelle:** Spalte „Schlagworte“, direkt bearbeitbar (mit Komma trennen).
- **Fach-Foto:** In der Prüfliste „Schlagworte für alle übernommenen Bücher“ – praktisch für thematische Fächer wie „Blankenese“.

## Automatische Sicherung (Chrome/Edge am PC)

Menü ⋯ → **💾 Automatische Sicherung** → „Ordner wählen & einschalten“. Chrome fragt einmal nach Erlaubnis für den Ordner. Danach:
- etwa eine Minute nach jeder Änderung wird gesichert – eine Datei pro Tag (`buecherregal-auto-JJJJ-MM-TT.json`), die letzten 14 Tage bleiben erhalten;
- E-Books/PDFs liegen einzeln im Unterordner `Dateien`;
- es geht nichts ins Internet. Wähle einen Ordner, der **nicht** mit einer Cloud abgeglichen wird (unter Windows ist „Dokumente“ oft mit OneDrive verbunden) – z. B. `C:\Bücherregal-Sicherung` oder eine externe Festplatte.
- Nach einem Neustart von Chrome erscheint ggf. oben ein Hinweis „Erlauben“ – einmal antippen. In neueren Chrome-Versionen kannst du beim Erlauben „Bei jedem Besuch zulassen“ wählen.
- **Wiederherstellen:** „Aus Sicherungsordner wiederherstellen“ liest den neuesten Stand samt Dateien ein. Neuere Änderungen auf dem Gerät bleiben erhalten.

Am Handy gibt es diese Funktion nicht – dort weiter „Sicherung exportieren“ nutzen.

## Cover aus dem Internet nachtragen

Bücher ohne Cover (z. B. aus Fach-Fotos) bekommen ihr Cover aus Google Books und Open Library:
- **Alle auf einmal:** Hinweis-Leiste oben in der Bücher-Ansicht („… Bücher haben noch kein Cover“), Menü ⋯ → „Fehlende Cover online nachtragen“ oder in der Verwaltung „🖼 Cover nachtragen“. Direkt nach einem Fach-Foto-Import fragt die App von selbst.
- **Eindeutig = automatisch:** Gibt es ein Cover genau zur ISBN, oder passt genau eine Ausgabe klar zu Titel, Autor und Verlag, wird es ohne Rückfrage übernommen.
- **Unsicher = Nachfrage:** Bei mehreren passenden Ausgaben oder unsicheren Treffern zeigt die App am Ende des Laufs alle Kandidaten mit Bild, Verlag, Jahr und ISBN; der wahrscheinlichste ist markiert. Du wählst, nimmst ein eigenes Foto oder überspringst.
- **Einzeln:** Auf der Buchseite „🖼 Cover online suchen“, in der Verwaltung das 🖼-Feld in der Cover-Spalte oder der Filter „Ohne Cover“. Im Bearbeiten-Modus holt „🌐 Online-Cover“ ebenfalls die Kandidaten.
- Bestehende Cover werden nie überschrieben; die Funktion füllt nur leere.
- **Pseudo-Cover:** Liefert ein Katalog eine Cover-Adresse, hinter der kein Bild steckt, gilt das Buch als „ohne Cover“: Die App prüft solche Adressen beim Start im Hintergrund und vor jedem Suchlauf, entfernt tote Adressen und nimmt die Bücher in den Suchlauf auf. Ein Bild, das sich beim Anzeigen als tot erweist, wird sofort so behandelt.

**Google-Bildersuche** (im Cover-Dialog unter „🔍 Google-Bildersuche“, im Bearbeiten-Modus als Knopf „🔍 Bildersuche“):
- **Ohne Einrichtung:** „Google Bilder öffnen ↗“ öffnet die Suche mit passendem Suchbegriff im neuen Tab. Dort ein Bild **anklicken** (große Vorschau rechts – die kleinen Bilder in der Trefferliste sind unscharf) und dann:
  - **PC:** Bild in die gestrichelte Fläche der App ziehen – oder Rechtsklick → **„Bild kopieren“** und in der App **Strg+V**. Auch „Bildadresse kopieren“ und kopierte Google-Links funktionieren; die App holt dann das Original.
  - **Handy:** Bild lange drücken → „Bild kopieren“, in der App auf **„📋 Aus Zwischenablage“** tippen (beim ersten Mal fragt der Browser um Erlaubnis) – oder in die gestrichelte Fläche tippen und „Einfügen“ wählen.
- Manche Webseiten geben ihre Bilder nicht zum Speichern heraus. Dann verlinkt die App das Bild (wird online angezeigt) oder meldet sich mit einem Hinweis; „Bild kopieren“ statt „Bildadresse kopieren“ hilft in diesem Fall fast immer.
- **Direkt in der App:** Mit einem eigenen Google-Schlüssel und einer Suchmaschinen-ID (Menü ⋯ → „Über die App & Einstellungen“ → „Google-Bildersuche“; kostenlos bis 100 Anfragen pro Tag) erscheinen die Bilder als Treffer in der App – antippen, fertig.
- „Google Bilder“ gibt es außerdem als Suchseite unter „Suchseiten wählen“.

## Verwaltung: filtern und sortieren

Unter den Spaltenüberschriften der Tabelle liegt eine **Filterzeile** (ein-/ausblendbar mit „Spaltenfilter“). Alle Filter wirken zusammen und zusätzlich zu Suche, Schlagwort und den Filter-Knöpfen.
- **Textspalten** (Titel, Autor, Verlag, Reihe, Schlagworte, Standort …): Text = enthält (Groß-/Kleinschreibung und Umlaute egal) · `!wort` = enthält nicht · `a | b` = oder · `=wort` = genau · `leer` / `!leer`.
- **Zahlen** (Jahr, Band, Seiten, Preis, Wert): `1990`, `>1990`, `<=20`, `1980-1990`, `leer`.
- **Datum** (Hinzugefügt, Gelesen): `2025`, `03.2025`, `>2024`, `2023..2025`, `leer` (= nie gelesen). Bei „Gelesen“ zählt jeder Lesedurchgang.
- **Auswahl** für Cover (mit/ohne), Status, Bewertung (ab n Sternen) und Lieblingsbuch.
- Ungültige Eingaben werden rot markiert und ignoriert. Esc leert ein Filterfeld.
- **Vorschläge:** Titel, Autor, Jahr, Verlag, Reihe, Genre, Schlagworte, Standort und „Fehlt“ schlagen beim Hineinklicken die vorhandenen Werte vor – die häufigsten zuerst, mit Anzahl. Es erscheinen nur Werte, die zu den übrigen Filtern passen (z. B. bei Status „Gelesen“ nur Autoren gelesener Bücher). Nach `|` kommt der nächste Vorschlag dazu, so wählst du mehrere Werte aus.

**Spalten anpassen:** „▦ Spalten“ blendet Spalten ein und aus (der Titel bleibt immer sichtbar). Die **Breite** änderst du, indem du in der Überschrift den rechten Rand einer Spalte ziehst; Doppelklick auf den Rand stellt die Standardbreite wieder her. „Breiten zurücksetzen“ gilt für alle Spalten. Der CSV-Export enthält immer alle Spalten.

**Dubletten finden:** „🧩 Dubletten prüfen“ in der Verwaltung zeigt Bücher mit gleicher ISBN (auch ISBN-10 = ISBN-13) oder gleichem Titel und Autor – außer wenn ISBN oder Band-Nr. verschieden sind, dann gelten sie als verschiedene Bände. Je Gruppe:
- **Zusammenführen:** Der ausgewählte Eintrag bleibt (vorgeschlagen wird der eingeräumte, vollständigere). Er übernimmt, was ihm fehlt: Angaben, Cover, Schlagworte, Notizen, Lesezeiten, Bewertung, weitere Bilder und Dateien, notfalls den Platz im Regal. Die anderen werden gelöscht.
- **Sind verschiedene Bücher:** z. B. zwei Exemplare. Die App merkt sich das (auch in Sicherung und Abgleich) und zeigt die Gruppe nicht mehr an.
- Stimmt nur eine ISBN nicht, „Öffnen“ und korrigieren. Der Filter-Knopf „🧩 Mögliche Dubletten“ zeigt dieselben Bücher in der Tabelle.

**Ansichten speichern:** Unter „⭐ Ansichten“ speicherst du die aktuelle Einstellung unter einem Namen, z. B. „Ungelesene Krimis“ oder „Inventur Wohnzimmer“. Gespeichert werden Filter, Suche, Filter-Knopf, Schlagwort, Sortierung, ausgeblendete Spalten und Spaltenbreiten. Ein Klick auf den Namen stellt alles wieder her. Hast du danach etwas verändert, steht „(geändert)“ dahinter. Unter demselben Namen erneut speichern aktualisiert die Ansicht, × löscht sie (die Bücher bleiben unverändert). „↺ Grundeinstellung“ setzt die Tabelle komplett zurück.

**Sortieren über mehrere Spalten:** Klick auf eine Überschrift sortiert danach (nochmal = umgekehrt). **Umschalt+Klick** fügt eine weitere Sortierstufe hinzu (z. B. Autor, dann Jahr absteigend). Am Handy über „＋ dann nach …“. Leere Werte stehen immer am Ende.

Bei großen Sammlungen zeigt die Tabelle zuerst 150 Bücher und lädt beim Herunterscrollen automatisch weitere nach („Alle anzeigen“ holt sofort alle). Zählung, Filter, Sortierung und CSV-Export gelten immer für alle Bücher.

Über der Tabelle stehen „x von y“, die aktiven Filter (einzeln mit × entfernbar, „Alle aufheben“) und die Sortierstufen. **„⬇ CSV (… gefiltert)“** exportiert genau die angezeigten Bücher in der angezeigten Reihenfolge. Filter, Sortierung, Spalten und gespeicherte Ansichten bleiben **auf diesem Gerät** gespeichert – sie gehören nicht zu den Buchdaten und werden weder gesichert noch abgeglichen.

## Lieblingsbücher

Bücher, von denen du dich nie trennen würdest, markierst du mit **♥ Lieblingsbuch** (auf der Buchseite, beim Bearbeiten oder in der Tabelle). Im Regal haben sie ein Herz am Cover, und der Filter **♥ Lieblingsbücher** zeigt nur sie – kombinierbar mit Ungelesen/Gelesen.

## Echtes Regal (Montana-Würfel)

Im Reiter **Echtes Regal** baust du deine Regalwand nach und räumst die Bücher so ein, wie sie bei dir stehen.

- **Regalwand anlegen:** Name vergeben und einen Start-Aufbau wählen, z. B. „Zwei 2er-Würfel nebeneinander“ oder „4er-Würfel + 2er-Würfel“. Mehrere Wände (z. B. Wohnzimmer, Arbeitszimmer) sind möglich.
- **Aufbau ändern:** Die Wand besteht aus Spalten; in jeder Spalte stapelst du Würfel. „＋2er“ = Montana 6112 (B 69,6 × H 35,4 × T 30 cm, 2 Fächer), „＋4er“ = Montana 1112 (B 69,6 × H 69,6 × T 38 cm, 4 Fächer), „＋Lücke“ für freie Stellen. Mit ▲ ▼ ◀ ▶ verschieben, Farbe wählen, ✕ entfernen.
- **Einräumen:** Rechts (am Handy unten) stehen die noch nicht eingeräumten Bücher. Buch antippen, dann auf ein Fach tippen (kommt ans Ende) oder auf das Buch, vor das es soll. Am PC geht auch Ziehen mit der Maus.
- **Buchrücken gestalten:** Buchrücken antippen → **🎨 Rücken gestalten** (auch auf der Buchseite unter „Standort“ und im Bearbeiten-Modus). Mit Live-Vorschau stehend und liegend:
  - **Farbe** (oder „aus Cover“) und **Schriftfarbe** (automatisch, hell, dunkel, gold)
  - **Text-Anordnung:** hochkant, quer, beides oder kein Text; eigener Text für beide, Position des Quertexts (oben/unten)
  - **Leserichtung** (deutsch: von unten nach oben, englisch: von oben nach unten), **Schrift** und **Schriftgröße**
  - **Dicke** und **Höhe** in cm (sonst geschätzt)
  - **Eigenes Foto** des Rückens: ersetzt Farbe und Text; Querformat-Fotos werden automatisch aufgerichtet, die Dicke wird aus dem Seitenverhältnis berechnet. Auch per Drag & Drop oder Strg+V.
  - **Zurücksetzen** macht den Rücken wieder automatisch.
- **Hochkant:** Im Aufbau-Modus dreht ⟳ einen 2er-Würfel hochkant (35,4 × 69,6 cm, zwei Fächer übereinander) und wieder zurück. Bereits eingeräumte Bücher wandern mit (links → oben, rechts → unten).
- **Buchrücken antippen:** nach links/rechts schieben, in ein anderes Fach umstellen, herausnehmen oder das Buch öffnen – und:
  - **▬ Hinlegen (stapeln):** Das Buch liegt quer in der Reihe. Mehrere liegende Bücher nebeneinander in der Reihe werden automatisch zu einem Stapel.
  - **⇧ Oben auf die Reihe legen:** Das Buch liegt quer auf den stehenden Büchern. Mehrere aufgelegte Bücher stapeln sich; mit ▲/▼ änderst du die Reihenfolge.
  - **⇅ In die hintere Reihe:** für Doppelreihen. Die hintere Reihe erscheint leicht versetzt und abgedunkelt hinter der vorderen. Mit dem Knopf **„⇅ hinten“** im Fach holst du sie nach vorne, um dort einzuräumen oder Bücher anzutippen; **„⇅ vorne“** schaltet zurück.
- **Wieder herausnehmen:** Buchrücken antippen → **„↩ Zurück zu ‚Noch nicht eingeräumt‘“**, am PC den Buchrücken einfach auf die Liste rechts ziehen, oder auf der Buchseite **„↩ Aus dem Regal nehmen“**. Suchst du in der Liste rechts nach einem eingeräumten Buch, steht daneben ebenfalls ↩. **„Ganzes Fach leeren“** nimmt alle Bücher eines Fachs auf einmal heraus.
- **Beim Einräumen** (Buch ausgewählt) zeigt jedes Fach zusätzlich **„⇧ drauflegen“** und – solange es noch keine hintere Reihe hat – **„⇅ hinten“**.
- **Darstellung:** Die Buchrücken sind symbolisch – die Breite wird aus der Seitenzahl geschätzt, die Farbe aus dem Cover. Jedes Fach ist innen ca. 33 × 33 cm; ist es rechnerisch voll (Reihe zu breit oder aufgelegter Stapel zu hoch), wird es rot umrandet.
- **Standort:** Auf jeder Buchseite steht, wo das Buch steht („Wohnzimmer · Spalte 1 · 4er-Würfel, Fach oben links · 3. Buch von links“), mit „Im Regal zeigen“. In der Tabelle gibt es eine Spalte „Standort“ und den Filter „Nicht eingeräumt“.
- Die Aufstellung wird mit der Sicherung exportiert und beim Import übernommen, wenn sie neuer ist.

## Fach-Fotos einlesen (viele Bücher auf einmal)

Unter **Buch hinzufügen → Weg C**, im **Echten Regal → 📷 Fach-Foto einlesen** oder beim Antippen eines Buchrückens (**„Dieses Fach per Foto einlesen“**):

1. Ziel-Fach wählen (oder „nicht einsortieren“) und ein ganzes Fach von vorne fotografieren bzw. ein Foto wählen.
2. Die App erkennt alle Buchrücken von links nach rechts – auch liegende Bücher, Bücher oben auf der Reihe und eine hintere Reihe. CDs, Karten, Prospekte werden als „kein Buch“ erkannt und standardmäßig übersprungen.
3. Für jedes Buch sucht sie in DNB, Google Books und Open Library die passende Ausgabe (Verlag wie „dtv“ zählt mit).
4. **Prüfliste:** Foto mit nummerierten Rahmen, je Buch der ausgeschnittene Rücken, erkannter Titel/Autor/**Band** (änderbar, dann „🔎 Neu suchen“), Katalogtreffer zur Auswahl oder „nur erkannte Angaben“. Bücher, die du schon hast, werden erkannt und nur einsortiert.
   - **Nachfrage bei Unsicherheit:** Unsichere Rücken sind **gelb markiert** (im Foto mit „?“), oben steht, wie viele es sind – mit „Nur unsichere zeigen“. Gründe sind z. B.: Rücken schlecht lesbar, mehrere ähnliche Katalogeinträge, Band nicht im Katalog, oder dasselbe Buch zweimal im Foto. Entweder korrigieren und neu suchen, einen Katalogtreffer wählen – oder **„✓ Passt so“**. Beim Übernehmen fragt die App nach, solange noch etwas ungeprüft ist.
   - **Reihen mit Bänden** (z. B. „Weihnachtsgeschichten am Kamin 8“): Die Band-Nummer zählt. Ein Katalogtreffer wird nur automatisch gewählt, wenn er denselben Band nennt – sonst werden die erkannten Angaben mit Reihe und Band übernommen (ohne fremde ISBN). Verschiedene Bände werden nie zu „Weiteres Exemplar“.
   - **Zwei gleiche Bücher im Foto** werden nach deinem „✓ Passt so“ zu zwei Exemplaren – und gelten danach nicht als Dublette.
5. **Übernehmen:** Neue Bücher werden angelegt und in Reihenfolge ins Fach gestellt (liegend, oben drauf, hinten wie erkannt). Wahlweise ersetzt das den bisherigen Fach-Inhalt oder wird angehängt. Die **Buchrücken-Bilder** werden direkt aus dem Foto geschnitten, Dicke und Höhe aus dem Foto berechnet.

**Erkennung – drei Wege** (wählbar beim Fach-Foto):
- **💬 Über deinen Claude-Chat** – nutzt dein Claude-Abo, ohne Zusatzkosten: Die App bereitet Foto und Auftrag vor. Am Handy „📤 An Claude teilen“ und die Claude-App wählen (oder „Auftrag kopieren“ und das Foto in einem neuen Chat auf claude.ai anhängen). Claude antwortet mit einem Codeblock – den kopieren und in der App einfügen, fertig. Das funktioniert genauso für einzelne Cover („💬 Mit Claude-Chat erkennen“ in der Suche nach einem Cover-Foto).
- **🤖 KI direkt (API-Schlüssel)** – vollautomatisch, siehe unten.
- **🔤 Einfache Texterkennung** – ohne KI, ungenau.

**KI direkt:** Für den vollautomatischen Weg braucht es die **KI-Erkennung** mit einem eigenen API-Schlüssel von Anthropic (Menü ⋯ → „Über die App & Einstellungen“ → „KI-Erkennung“). Abgerechnet wird pro Foto über dein eigenes API-Konto, meist wenige Cent. Der Schlüssel bleibt nur in deinem Browser und ist nicht in der Sicherung. Ohne Schlüssel nutzt die App eine **einfache Texterkennung** im Browser – die findet nur gut lesbare Rücken und braucht mehr Nacharbeit.

Tipps fürs Foto: gerade von vorne, ganzes Fach im Bild, gutes Licht, kein Blitz-Spiegeln auf Folien.

## 4. Handy und PC abgleichen

Jedes Gerät hat sein eigenes Regal. So bringst du sie zusammen:

1. Auf dem Handy: Menü **⋯ → „Sicherung exportieren“** → die Datei an dich selbst schicken (Mail, Messenger, Cloud-Ordner).
2. Am PC: Menü **⋯ → „Sicherung importieren & abgleichen“** → Datei wählen.

Die Bücher werden zusammengeführt: Neue kommen dazu, bei Änderungen gewinnt die jeweils neuere, Gelöschtes wird auch drüben gelöscht. Das funktioniert in beide Richtungen.

### Automatisch abgleichen über den eigenen PC (optional)

Statt Dateien hin- und herzuschicken, kann sich die App über eine kleine Datenbank (CouchDB) auf deinem PC selbst abgleichen –
ohne Cloud, auch unterwegs, sobald der PC an ist. Einrichtung Schritt für Schritt: **`ABGLEICH-EINRICHTEN.md`**.
Danach: Menü **⋯ → „🔄 Abgleich mit eigenem Server“**. Das **⟳** oben zeigt, ob gerade abgeglichen wird (rot = Problem, antippen).
Freunde, die keinen eigenen Server haben, nutzen die App einfach wie bisher.

## 5. Sicherheit deiner Daten

- Die Daten liegen im Speicher des Browsers. **Wenn du die Browserdaten/Websitedaten löschst, ist das Regal weg.** Die App erinnert dich alle 14 Tage an eine Sicherung.
- Die Sicherungsdatei (`.json`) enthält alles inklusive Cover-Fotos. Bewahre sie gut auf.
- **Am PC am bequemsten:** Menü ⋯ → **💾 Automatische Sicherung** (Chrome/Edge). Ein Stand pro Tag, die letzten 14 Tage bleiben. Ordner auf einem USB-Stick oder einer externen Festplatte wählen.
- **Auch mit Abgleich wichtig:** Der Abgleich verteilt jede Änderung auf alle Geräte – auch ein versehentliches Löschen. Nur eine ältere Sicherung holt so etwas zurück.
- „CSV für Excel“ (Verwaltung oder Menü) gibt dir eine Tabelle zum Weiterverarbeiten.

## 6. An Freunde weitergeben

Schick ihnen einfach deine Adresse (z. B. `https://DEIN-NAME.github.io/buecherregal/`). Jede Person hat ihr **eigenes, privates Regal** auf ihrem Gerät – niemand sieht die Bücher der anderen, auch du nicht.

## Gut zu wissen

- **Neue Version:** Wurde die App aktualisiert, erscheint unten „Neue Version der App ist da“. „Jetzt aktualisieren“ lädt sie neu; mit ✕ geht es später beim nächsten Öffnen.

- Erfassen braucht Internet (für Buchdaten und Cover). Ansehen, Notizen, Bewertungen und Verwaltung funktionieren auch offline.
- Diktieren (🎙) gibt es in Chrome, Edge und Safari. Sonst geht das Mikrofon der Handy-Tastatur.
- Die Texterkennung auf Covern lädt beim ersten Mal einige MB Sprachdaten. Bei verschnörkelten Schriften klappt sie nicht immer – dann einfach den Titel eintippen.
- Google Books teilt ohne Schlüssel ein kleines Kontingent mit allen Nutzern und antwortet dann oft nicht. Abhilfe: unter Menü ⋯ → „Über die App & Einstellungen“ einen eigenen kostenlosen Google-Books-Schlüssel eintragen (Anleitung steht dort). Die DNB braucht keinen Schlüssel.
- Klappentexte liefern vor allem Google Books und Open Library; die DNB liefert sehr genaue Ausgabedaten, aber meist keinen Klappentext.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Die App-Seite |
| `app.js` | Die gesamte Logik |
| `style.css` | Aussehen |
| `sw.js` | Offline-Fähigkeit |
| `manifest.webmanifest`, `icons/` | Installation als App |
