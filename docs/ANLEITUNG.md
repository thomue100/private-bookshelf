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

## Überblick: wo finde ich was?

- **Am Handy** steht unten eine Leiste: **Bibliothek** (alle Bücher), **Regal** (dein echtes Regal), in der Mitte **＋** (Buch hinzufügen), **Wünsche** (Wunschliste) und **Mehr**.
- **Am PC** steht dasselbe oben in der Kopfzeile, zusätzlich **Tabelle** und rechts **＋ Buch hinzufügen**. Tastenkürzel: **/** springt in die Suche, **N** öffnet „Buch hinzufügen“, **Esc** schließt ein Fenster.
- **Mehr** sammelt alles, was man nicht jeden Tag braucht – in vier Gruppen: *Viele Bücher erfassen* (Stapel, Fach-Foto, gespeicherte Fach-Fotos, Titelliste), *Bestand pflegen* (Tabelle, fehlende Cover, Dubletten, Maße), *Daten & Sicherung* (Sicherung exportieren/importieren, automatische Sicherung, Abgleich, CSV) und *Einstellungen & Hilfe*. Zahlen rechts zeigen, ob dort etwas zu tun ist.
- **Bibliothek:** oben Suche und Status (Alle, Ungelesen, Gerade dabei, Gelesen, ♥). Schlagwort, Reihe, Sortierung und die Umschaltung **Cover / Liste** stehen am Handy hinter **„Filter“** (die Zahl daran zeigt aktive Filter). Bücher, die du gerade liest, stehen oben unter **„Gerade dabei“** – **„✓ Ausgelesen“** markiert sie mit einem Tipp als gelesen (rückgängig über die Meldung unten). Die Listenansicht zeigt zusätzlich Lesestatus und Standort im Regal.

## 3. Bücher erfassen

„Buch hinzufügen“ zeigt oben die beiden schnellsten Wege (**Barcode scannen** und **Cover fotografieren**) und darunter **ein Feld für alles**: Titel und/oder Autor, ISBN oder ein Link aus dem Web – die App erkennt selbst, was gemeint ist. Unter **„Viele Bücher auf einmal“** stehen Stapel, Fach-Foto und Titelliste; ganz unten „Ganz von Hand eintragen“.

- **Barcode:** „Barcode scannen“ → Kamera über den ISBN-Barcode halten. Die Buchdaten kommen von der Deutschen Nationalbibliothek (DNB), Google Books und Open Library.
  - Ein grüner Rahmen zeigt, wo die App den Barcode gerade sieht. Bei wenig Licht schaltet **„🔦 Licht“** die Taschenlampe ein (wenn Handy und Browser es können). Die Kamera stellt laufend scharf.
  - Gezählt werden nur Buch-Barcodes (Nummer beginnt mit 978 oder 979, Prüfziffer stimmt). Andere Strichcodes – Preisschild, Lebensmittel – erklärt die App, statt sie zu übernehmen; der kleine Preis-Zusatzcode rechts neben dem ISBN-Barcode wird ignoriert.
  - Bei einem Foto sucht die App den Barcode auch in Ausschnitten – ein kleiner Barcode in einem großen Foto wird so meist trotzdem gefunden.
- **Cover-Foto:** Vorderseite fotografieren (oder am PC ein Bild wählen, hineinziehen oder mit Strg+V einfügen). Die App liest den Text vom Cover und zeigt passende Bücher zur Auswahl. Dein Foto kann als Cover dienen.
  - Mit KI-Schlüssel vergleicht Claude dein Foto mit den Covern der Treffer (abschaltbar, dieselbe Einstellung wie beim Fach-Foto). Ist Claude sicher, steht die passende Ausgabe oben, markiert mit „🤖 Claude: das ist diese Ausgabe“ und dem Grund – das hilft besonders bei Übersetzungen und Neuauflagen mit ähnlichem Cover. Ist Claude nur unsicher, bleibt die Reihenfolge; die vermutete Ausgabe ist markiert und die weiteren Treffer sind aufgeklappt. Passt keiner, steht ein Hinweis darüber.
- Außerdem: im Feld „Titel, Autor, ISBN oder Link“ suchen oder komplett von Hand eintragen.
- **Buch im Web gefunden (ZVAB, booklooker, Amazon, DNB, Google Books …)?** Nichts abtippen:
  - **Link einfügen:** Adresse der Buchseite kopieren und ins Feld „Titel, Autor, ISBN oder Link“ (bzw. unter den Suchtreffern bei „Im Web gefunden?“) einfügen oder **„📋 Einfügen“** antippen. Die App holt sich die ISBN selbst und lädt die Buchdaten. Kopierter Seitentext mit ISBN geht genauso.
  - **Automatisch:** Nach einem Klick auf einen der Links „Im Internet suchen“ schaut die App beim Zurückkommen in die Zwischenablage. Hast du dort eine ISBN oder einen Link kopiert, erscheint unten **„In der Zwischenablage: … – Übernehmen“**. (Der Browser fragt beim ersten Mal, ob die App die Zwischenablage lesen darf.)
  - **Am Handy (installierte App):** Auf der Buchseite im Browser oder in der Shop-App **„Teilen → Bücherregal“** – das Buch wird direkt übernommen.
  - Steht in der Adresse keine ISBN (z. B. bei Thalia), sucht die App mit dem Titel aus der Adresse in den Katalogen.
- **Suche nach Titel/Autor:** Gesucht wird gleichzeitig in der Deutschen Nationalbibliothek, in den Bibliotheksverbünden (lobid und K10plus – letzterer kennt besonders viele ältere deutsche Bücher ohne ISBN), bei Google Books und Open Library – es reicht, wenn einer davon das Buch kennt. Bände einer Reihe findest du mit der Nummer, z. B. „Weihnachtsgeschichten am Kamin Band 27“ (oder „Bd. 27“ bzw. einfach „27“); der passende Band steht dann oben, Reihe und Band-Nr. werden übernommen. Findet die erste Suche wenig, sucht die App automatisch noch einmal breiter. Ganz oben steht groß der **beste Treffer mit Cover** – meist reicht ein Tipp auf **„Das ist es“**. Andere Ausgaben (anderer Verlag, Jahr, E-Book …) findest du unter **„Andere Ausgabe? … weitere Treffer anzeigen“**; die ISBN zeigt, welche Ausgabe es ist. Deutsche gedruckte Ausgaben stehen vor Übersetzungen, E-Books, Hörbüchern und Lernhilfen. Tipp: Titel **und** Autor eingeben (z. B. „Der Vorleser Schlink“) – dann ist der beste Treffer fast immer der richtige. **Mehrere Bücher auf einmal**, z. B. alle Agatha-Christie-Titel, die du hast: nach „Agatha Christie“ suchen, **„☑ Mehrere übernehmen“** drücken, die Bücher anhaken (oder „Alle … auswählen“), oben **„📚 In den Bestand“** oder **„⭐ Auf die Wunschliste“** wählen und unten übernehmen. Was schon im Regal steht, ist gekennzeichnet und lässt sich nicht anhaken; ein Buch von der Wunschliste wird als gekauft übernommen. Eingestellte Vorgaben (Fach, Schlagworte, Status) gelten auch hier. Shops wie ZVAB, booklooker oder Amazon lassen sich nicht direkt aus der App durchsuchen; dafür gibt es unter den Treffern die Links „Im Internet suchen“.
- **📚 Stapel erfassen** (viele Bücher nacheinander, z. B. eine Kiste oder ein Stapel vom Flohmarkt): Die Kamera bleibt die ganze Zeit offen.
  1. Barcode in den Rahmen halten. Es piept bzw. vibriert, das Buch ist im Stapel. Danach auf Wunsch **„📷 Cover“** und **„📷 Rücken“** fotografieren. Mit **„Weiter ▶“** geht es zum nächsten Buch. Zeigst du gleich den nächsten Barcode, geht es auch ohne Tippen weiter.
  2. **Bücher ohne Barcode:** „📷 Cover (ohne Barcode)“.
     - Scannst du ein Buch, das **schon im Stapel** ist, sagt die App „Schon im Stapel (Nr. …)“ und legt es nicht noch einmal an. Ist es wirklich ein zweites Exemplar, tippe **„＋ Zweites Exemplar“**.
     - Steht das Buch **schon in deinem Regal**, siehst du das gleich beim Scannen (gelb).
  3. **„✓ Fertig – prüfen“** öffnet die Prüfliste. Grün heißt sicher erkannt (über die ISBN), gelb heißt bitte prüfen. Titel und Autor lassen sich direkt ändern. Bücher, die du schon hast, sind nicht angehakt. Steht ein Buch auf der Wunschliste, wird es als gekauft übernommen.
  4. **Bücher ohne Barcode erkennen:** Mit KI-Schlüssel erkennt „🤖 … ohne Barcode erkennen“ alle auf einmal (Sammelauftrag zum halben Preis, meist unter einer Stunde). Ohne Schlüssel geht es je Buch über „💬 Mit Claude-Chat erkennen“, oder du trägst Titel und Autor selbst ein.
  5. **„… Bücher übernehmen“** legt alle angehakten Bücher an, mit deinen Fotos als Cover und Rücken.
  - Buchdaten lädt die App schon während des Fotografierens im Hintergrund. Jedes Foto wird sofort gespeichert: Schließt das Handy die App, geht nichts verloren. Unter „Buch hinzufügen“ steht dann „Stapel prüfen (…)“.
  - Der Stapel bleibt auf diesem Gerät. Er gehört nicht zur Sicherung und nicht zum Abgleich. Erst die übernommenen Bücher sind ganz normal dabei.
- **📋 Titelliste einfügen** (viele Bücher auf einmal, z. B. aus einer alten Excel-Tabelle, einer Notiz oder einer Mail): In „Buch hinzufügen“ (oder unter „Mehr“) auf **„Titelliste einfügen“** tippen. Dann die Liste ins Feld einfügen, „📋 Aus Zwischenablage“ antippen oder eine Datei wählen (.txt, .csv; am PC auch hineinziehen).
  - **Eine Zeile = ein Buch.** Nummern und Aufzählungszeichen am Anfang stören nicht. Die App versteht zum Beispiel:
    ```
    Momo – Michael Ende
    Michael Ende: Die unendliche Geschichte
    Preußler, Otfried: Krabat
    Krabat von Otfried Preußler
    Tschick (Wolfgang Herrndorf)
    Weihnachtsgeschichten am Kamin Bd. 27
    Der Name der Rose (dtv, 1998)
    978-3-423-12345-6
    ```
    Steht eine ISBN in der Zeile, lädt die App genau diese Ausgabe. Kann sie eine Zeile nicht sicher zerlegen, sucht sie mit der ganzen Zeile.
  - **Aus Excel:** Die Spalten markieren (gern mit Überschrift wie „Titel“, „Autor“, „ISBN“, „Jahr“, „Reihe“, „Band“, „Schlagworte“), kopieren und einfügen. Eine Excel-Datei selbst kann die App nicht öffnen, als CSV gespeichert geht es aber. Auch das CSV aus der Tabelle („⬇ CSV für Excel“) lässt sich wieder einlesen. Übernommen werden daraus Titel, Autor, ISBN, Verlag, Jahr, Reihe, Band und Schlagworte. Lesestatus und Notizen kommen nicht mit, für ein komplettes Zurückholen ist die Sicherung da.
  - **Vorschau:** Vor der Suche siehst du, was die App erkannt hat. Felder lassen sich ändern, × entfernt eine Zeile. Bei Tabellen legst du je Spalte fest, was darin steht, falls die App falsch geraten hat.
  - **Suche:** Die App sucht jedes Buch in DNB, Bibliotheksverbund, Google Books und Open Library, schonend nacheinander. „Anhalten“ geht jederzeit. Schließt das Handy die App, steht beim nächsten Öffnen unten **„Titelliste weiter prüfen“** (oder „verwerfen“), und es geht dort weiter. Mit „Später weiter“ in der Prüfliste geht das genauso.
  - **Prüfliste** wie beim Fach-Foto: Ohne Markierung heißt sicher gefunden, gelb heißt bitte prüfen. Über jedem Buch steht deine Originalzeile. Du kannst einen anderen Treffer wählen, „Nur meine Angaben aus der Liste übernehmen“, Titel, Autor oder Band ändern und „🔎 Neu suchen“, „✓ Passt so“ oder „überspringen“. Unter „Im Internet suchen / Link einfügen“ stehen die Suchseiten; einen Link von ZVAB, booklooker usw. oder eine ISBN fügst du dort ein, und das wird der Treffer.
  - Bücher, die du schon hast, sind nicht angehakt (Haken setzen = weiteres Exemplar). Bücher von deiner Wunschliste werden als gekauft übernommen.
  - **Für alle:** Bestand oder Wunschliste (im Wunschlisten-Modus vorausgewählt), Lesestatus, Schlagworte (vorgeschlagen „Liste-Import“, mit × entfernbar; Schlagworte aus der Liste kommen dazu) und auf Wunsch ein Ziel-Fach. Die Bücher kommen dann in Listenreihenfolge ans Ende des Fachs.
  - Ohne Internet werden deine Angaben übernommen (gelb). Fehlendes ergänzt später „🔎 Leere Felder online ergänzen“. Einen KI-Schlüssel braucht es dafür nicht.
- **Rückenfoto gleich mit erfassen:** In „Prüfen & speichern“ steht unter dem Cover das Feld **„📷 Rücken“**. Am Handy öffnet „📷 Foto“ direkt die Kamera; am PC ein Bild wählen, in die gestrichelte Fläche ziehen oder die Fläche anklicken und Strg+V drücken. (Strg+V an anderer Stelle setzt wie bisher das Cover.) Querformat-Fotos werden aufgerichtet, die Dicke wird aus dem Foto berechnet. „entfernen“ nimmt das Foto wieder weg. Das Buch steht dann im echten Regal gleich mit seinem echten Rücken.
- **Ein Foto für Cover und Rücken:** Fotografiere das Buch schräg, sodass Vorderseite und Rücken zu sehen sind (Cover-Foto). Mit KI-Schlüssel findet Claude die Ecken von Cover und Rücken. Die App macht daraus ein gerades Cover und ein gerades Rückenfoto, der Hintergrund fällt weg. Das klappt genauso über die Claude-Chat-Brücke.
- **✂ Zuschneiden** (unter einem eigenen Cover-Foto, auch beim Bearbeiten): Die vier Ecken auf die Ecken des Buchs ziehen. Beim Ziehen zeigt eine Lupe die Ecke vergrößert. Mit dem Reiter **„📗 Rücken“** markierst du auch den Rücken. Das funktioniert ohne KI und bei jedem Cover-Foto. Stimmen die Ecken der KI nicht ganz, korrigierst du sie hier. Zugeschnitten wird immer aus dem Originalfoto.
- **Buchhöhe automatisch:** Die Deutsche Nationalbibliothek (und der Bibliotheksverbund) nennen bei vielen Büchern das Format, z. B. „21 cm“ oder „24 x 17 cm“. Die App übernimmt daraus die **Höhe** für den Buchrücken im echten Regal – aber nur, wenn noch keine Höhe eingetragen ist. Selbst gemessene oder aus einem Fach-Foto berechnete Höhen bleiben immer erhalten. „🔎 Leere Felder online ergänzen“ trägt eine fehlende Höhe ebenfalls nach. Für schon erfasste Bücher: unter **Mehr → „📏 Maße nachtragen“** (siehe unten).
- **📏 Maße nachtragen (Bereinigungslauf):** ergänzt bei allen Büchern, was noch fehlt – **Höhe**, **Dicke** und **Rückenbild**. Vorhandene Werte werden nie überschrieben; den Lauf kannst du beliebig oft wiederholen. Die Quellen, in dieser Reihenfolge:
  1. **Deine gespeicherten Fach-Fotos:** Die App ordnet die erkannten Rücken den Büchern zu, die in diesem Fach stehen (nur bei eindeutigem Titel), und misst Höhe und Dicke aus dem Foto. Fehlt das Rückenbild, wird es aus dem Foto ausgeschnitten. Bei einem Fach aus mehreren Fotos wird nur die Höhe übernommen. Kostet nichts und braucht kein Internet.
  2. **Deutsche Nationalbibliothek:** die Höhe (bei Büchern mit ISBN).
  3. **Google Books:** Höhe und Dicke, wo Google sie kennt (bei Büchern mit ISBN; bei deutschen Ausgaben nicht immer vorhanden).
  Hatten die Kataloge für ein Buch keine Maße, fragt der nächste Lauf 60 Tage lang nicht erneut („Trotzdem neu fragen“ geht immer). Mit „Anhalten“ lässt sich der Lauf jederzeit beenden.
- **Fach-Foto bei schon vorhandenen Büchern:** Übernimmst du ein Fach-Foto und ein Buch ist schon in der Bibliothek, bekommt es fehlende Höhe, Dicke, Farben und Rückenbild aus dem Foto – Vorhandenes bleibt.
- **Internetsuche:** Unter den Treffern, beim Bearbeiten und auf jeder Buchseite stehen Links zu Suchseiten. Welche, bestimmst du selbst: **Mehr → „Suchseiten wählen“** (oder „⚙︎ anpassen“ neben den Links). Zur Auswahl stehen u. a. Google, ZVAB, SLUB Dresden, DNB-Katalog, booklooker, Thalia, Amazon, AbeBooks, Google Books und Open Library. Eigene Seiten (z. B. deine Stadtbibliothek) fügst du mit einer Such-Adresse hinzu, in der der Suchbegriff durch `{q}` ersetzt ist. ZVAB und booklooker suchen nach Titel + Autor (findet alle Ausgaben), die übrigen nach ISBN, falls vorhanden.

## Bücher bearbeiten

- Ein Klick auf ein Buch öffnet die **Ansicht**. Lesestatus und Sterne kannst du dort direkt umschalten.
- **✏️ Bearbeiten** öffnet alle Angaben: Cover (Foto, Datei, Drag & Drop, Strg+V, Online-Cover, entfernen), Lesestatus, Bewertung, Datumsangaben, Notizen und sämtliche Buchdaten.
- **Rückenfoto nachtragen:** Im Bearbeiten-Modus unter „Buchrücken (echtes Regal)“ direkt **„📷 Rückenfoto“** – ohne Umweg über „🎨 Gestalten“. Eine schon eingetragene Dicke bleibt dabei erhalten.
- Änderungen werden erst mit **💾 Speichern** übernommen (am PC auch mit Strg+S). „Abbrechen“ oder Schließen fragt nach, wenn noch etwas ungespeichert ist.
- **🔎 Leere Felder online ergänzen** füllt nur leere Felder; **↻ Alles per ISBN neu laden** überschreibt die Buchdaten mit den Online-Daten zur ISBN (Notizen, Bewertung, Status bleiben). Beides wird erst beim Speichern übernommen.
- In der **Tabelle** öffnet ✏️ direkt den Bearbeiten-Modus. Änderungen direkt in den Tabellenzellen werden wie in Excel sofort gespeichert.
- „Speichern & nächstes“ ist praktisch, wenn du einen ganzen Stapel erfasst.

## Vorgaben für einen Stapel

Stehen alle Bücher eines Stapels im selben Fach oder gehören zum selben Thema? Lege es einmal vorab fest. Oben in „Buch hinzufügen“ auf **„⚙ Vorgaben für alle Bücher festlegen“** tippen:
- **Ziel-Fach** im echten Regal (oder „nicht einsortieren“), **Schlagworte**, **Lesestatus** und **Bestand oder Wunschliste**.
- Die Vorgaben gelten für **„Speichern & nächstes“** und für **„📚 Stapel erfassen“**. Jedes Buch übernimmt sie und kommt in der Reihenfolge, in der du es erfasst hast, **ans Ende des Fachs**. Bücher auf der Wunschliste werden nicht eingeräumt.
- In „Prüfen & speichern“ sind Status, Schlagworte und Bestand/Wunschliste schon ausgefüllt. Du kannst sie für ein einzelnes Buch trotzdem ändern.
- Solange die Vorgaben eingeschaltet sind, stehen sie oben als Leiste („Vorgaben: 📍 Wohnzimmer · … · #Flohmarkt“), auch im Stapel-Modus über dem Kamerabild. **„ändern“** passt sie an, **„aus“** schaltet sie ab. Sie bleiben dann gespeichert und lassen sich wieder einschalten.
- Die Vorgaben gelten nur auf diesem Gerät und gehören nicht zu den Buchdaten.

## Mehrfach gelesen

Unter „Gelesen (auch mehrfach)“ trägst du beliebig viele Lesedurchgänge ein – jeweils mit Anfang, Ende und optionaler Notiz („im Urlaub“, „Hörbuch“). Setzt du ein bereits gelesenes Buch wieder auf **Gerade dabei**, beginnt automatisch ein neuer Durchgang mit dem heutigen Datum; **Gelesen** schließt ihn ab. Auf der Buchseite steht dann z. B. „2× gelesen“ mit allen Zeiträumen, in der Tabelle die Spalte „Gelesen“.

## Hatte ich mal

Hast du ein Buch verschenkt, gespendet, verkauft, getauscht oder verloren, tippe auf der Buchseite **📦 Hatte ich mal …** (oder im Bearbeiten-Modus unter „Besitz“). Du wählst, was passiert ist, an wen es ging, wann – und kannst einen Kommentar schreiben. Das Buch:
- verschwindet aus dem normalen Regal und erscheint **ausgegraut in der Liste „Hatte ich mal“** unten in der Bücher-Ansicht (auf- und zuklappbar),
- wird aus dem echten Regal herausgenommen,
- behält alle Notizen, Bewertungen und Lesedaten.
„↩ Wieder in meinem Besitz“ macht es rückgängig. In der Tabelle gibt es den Filter „📦 Hatte ich mal“. „Löschen“ entfernt ein Buch dagegen endgültig.

## Widmung, Signatur, weitere Bilder und Dateien

Im Bearbeiten-Modus eines Buches:
- **Widmung & Signatur:** „✍ Signiertes Exemplar“ ankreuzen, „Signiert von / Anlass“ und den Wortlaut der Widmung eintragen. In der Tabelle zeigt die Spalte „Extras“ das an; die Suche findet auch Widmungstexte.
- **Weitere Bilder:** beliebig viele Fotos (Widmung, Signatur, Rückseite, Zustand, Kaufbeleg …) mit Beschriftung – per Kamera, Datei oder Drag & Drop. Auf der Buchseite als Galerie, Antippen vergrößert.
- **Dateien:** E-Books (EPUB, MOBI …), PDFs, Hörbücher oder andere Dateien zum Buch. Auf der Buchseite „Öffnen“ (PDFs im Browser) oder ⬇ herunterladen.
- Alles wird erst mit „💾 Speichern“ übernommen.

Bilder und Dateien liegen in einem eigenen Speicher im Browser, damit die App auch mit großen PDFs schnell bleibt. Beim **Export** fragt die App, ob weitere Bilder und Dateien mit in die Sicherung sollen (große Dateien machen die Sicherung groß). Was du weglässt, bleibt beim Import auf dem anderen Gerät erhalten, wenn es dort schon vorhanden ist.

**Ältere Sicherungen** (aus allen bisherigen Versionen der App) lassen sich weiterhin importieren; vorhandene Bücher im Browser werden beim Update automatisch übernommen.

## Preis und heutiger Wert

Bei den Buchdaten gibt es **Preis (€)** und **Heutiger Wert (€)** (z. B. „12,90“). Beide erscheinen auf der Buchseite unter „Details“, als Spalten „Preis €“ und „Wert €“ in der Tabelle (sortierbar, direkt bearbeitbar) und im CSV-Export.

## Reihe und Band

Bei den Buchdaten gibt es **Reihe** (mit Vorschlägen aus deinen bisherigen Reihen) und **Band-Nr.**. Die Deutsche Nationalbibliothek liefert die Reihe oft gleich mit; beim Fach-Foto werden z. B. dtv-Nummern als Reihe „dtv“ mit Bandnummer übernommen.
- In der Bücher-Ansicht: Auswahl **„Alle Reihen“** – zeigt nur diese Reihe, nach Band sortiert. Sortierung **„Reihe & Band“** sortiert alles so.
- Auf der Buchseite: „📚 Reihe · Band 3“ antippen zeigt alle Bände der Reihe.
- In der Tabelle: Spalten „Reihe“ und „Band“ (sortierbar, direkt bearbeitbar).

## Wunschliste (getrennt vom Bestand)

Bereich **Wünsche** (Wunschliste): Bücher, die du noch nicht besitzt.
- **Hinzufügen:** dort „＋ Wunsch hinzufügen“ (alle Wege: Barcode, Cover, Suche, ISBN, von Hand). Beim Prüfen kannst du jederzeit zwischen „📚 In meinen Bestand“ und „⭐ Auf die Wunschliste“ wählen.
- **Getrennt:** Wünsche erscheinen nicht im Regal, nicht im echten Regal und zählen in keiner Bestandszahl mit. Die Suche im Regal weist nur darauf hin („Auch auf deiner Wunschliste: 1 Treffer“).
- **Gekauft?** Buch öffnen → **„✓ Gekauft – in den Bestand übernehmen“**. Erfasst du ein Buch, das auf der Wunschliste steht (oder taucht es auf einem Fach-Foto auf), fragt die App bzw. übernimmt es automatisch als gekauft – ohne Doppel.
- Die Wunschliste zeigt die Summe der eingetragenen Preise. In der Tabelle gibt es den Filter „⭐ Wunschliste“; im Bearbeiten-Modus lässt sich unter „Besitz“ umschalten.

## Schlagworte

Im Bearbeiten-Modus (und beim Erfassen) unter den Buchdaten: Schlagwort eintippen und Enter drücken – bereits benutzte Schlagworte werden vorgeschlagen, Groß-/Kleinschreibung wird angeglichen. Mehrere auf einmal mit Komma.
- **Filtern:** Auswahl „Alle Schlagworte“ in der Bibliothek und in der Tabelle; oder auf der Buchseite ein Schlagwort antippen.
- **Suchen:** Die normale Suche findet Schlagworte mit.
- **Tabelle:** Spalte „Schlagworte“, direkt bearbeitbar (mit Komma trennen).
- **Fach-Foto:** In der Prüfliste „Schlagworte für alle übernommenen Bücher“ – praktisch für thematische Fächer wie „Blankenese“.

## Automatische Sicherung (Chrome/Edge am PC)

**Mehr → „Automatische Sicherung“** → „Ordner wählen & einschalten“. Chrome fragt einmal nach Erlaubnis für den Ordner. Danach:
- etwa eine Minute nach jeder Änderung wird gesichert – eine Datei pro Tag (`buecherregal-auto-JJJJ-MM-TT.json`), die letzten 14 Tage bleiben erhalten;
- Bilder (Cover, Buchrücken, weitere Bilder, offene Fach-Fotos) liegen einzeln im Unterordner `Bilder`, E-Books/PDFs im Unterordner `Dateien`. Jedes Bild wird nur einmal gespeichert, die Tagesdateien verweisen nur darauf und bleiben deshalb klein. Bilder, die kein aufgehobener Tagesstand mehr braucht, räumt die App selbst weg. Den Ordner deshalb immer **komplett** kopieren oder verschieben;
- „Sicherung exportieren“ macht weiter eine einzige, vollständige Datei mit allen Bildern – die ist zum Mitnehmen auf ein anderes Gerät gedacht;
- es geht nichts ins Internet. Wähle einen Ordner, der **nicht** mit einer Cloud abgeglichen wird (unter Windows ist „Dokumente“ oft mit OneDrive verbunden) – z. B. `C:\Bücherregal-Sicherung` oder eine externe Festplatte.
- Nach einem Neustart von Chrome erscheint ggf. oben ein Hinweis „Erlauben“ – einmal antippen. In neueren Chrome-Versionen kannst du beim Erlauben „Bei jedem Besuch zulassen“ wählen.
- **Wiederherstellen:** „Aus Sicherungsordner wiederherstellen“ liest den neuesten Stand samt Dateien ein. Neuere Änderungen auf dem Gerät bleiben erhalten.

Am Handy gibt es diese Funktion nicht – dort weiter „Sicherung exportieren“ nutzen.

## Cover aus dem Internet nachtragen

Bücher ohne Cover (z. B. aus Fach-Fotos) bekommen ihr Cover aus Google Books, Open Library und Amazon (über die ISBN; dabei geht nur die ISBN an Amazon):
- **Alle auf einmal:** Hinweis oben in der Bibliothek („… Bücher ohne Cover“ → „🖼 Cover nachtragen“; „Später“ blendet ihn aus, bis weitere Bücher ohne Cover dazukommen), **Mehr → „Fehlende Cover nachtragen“** oder in der Tabelle „🖼 Cover nachtragen“. Direkt nach einem Fach-Foto-Import fragt die App von selbst.
- **Eindeutig = automatisch:** Gibt es ein Cover genau zur ISBN, oder passt genau eine Ausgabe klar zu Titel, Autor und Verlag, wird es ohne Rückfrage übernommen.
- **Unsicher = Nachfrage:** Bei mehreren passenden Ausgaben oder unsicheren Treffern zeigt die App am Ende des Laufs alle Kandidaten mit Bild, Verlag, Jahr und ISBN; der wahrscheinlichste ist markiert. Du wählst, nimmst ein eigenes Foto oder überspringst.
- **Einzeln:** Auf der Buchseite „🖼 Cover online suchen“, in der Tabelle das 🖼-Feld in der Cover-Spalte oder der Filter „Ohne Cover“. Im Bearbeiten-Modus holt „🌐 Online-Cover“ ebenfalls die Kandidaten.
- **Nicht immer wieder dasselbe suchen:** Findet der Sammellauf für ein Buch nichts (oder du wählst „Überspringen“), merkt sich die App das 60 Tage lang und lässt das Buch beim nächsten Lauf aus. Der Lauf sagt, wie viele übersprungen wurden; „Einzeln mit Bildersuche durchgehen“ bzw. „Trotzdem alle neu suchen“ holen sie zurück. Änderst du Titel, Autor oder ISBN, wird das Buch wieder gesucht. (Gilt nur für dieses Gerät.)
- **Ohne Treffer → Bildersuche:** Am Ende des Laufs geht „… ohne Treffer mit Bildersuche durchgehen“ die Bücher nacheinander durch – jeweils mit offener Google-Bildersuche.
- **📚 Weitere Ausgaben suchen** (im Cover-Dialog): sucht mit frei wählbarem Begriff (z. B. nur Titel, oder mit Verlag) in Google Books, DNB, Bibliotheksverbund und Open Library und zeigt alle gefundenen Cover – **antippen, fertig**.
- **Nur gespeicherte Cover:** Die App übernimmt nur Bilder, die sie wirklich speichern kann – die sind offline da und stecken in der Sicherung. Google Books zeigt seine Cover zwar an, gibt sie aber nicht zum Speichern heraus; die App nimmt dann automatisch ein speicherbares Bild derselben Ausgabe (Amazon, Open Library). Reine Links (alte „verlinkte“ Cover) räumt die App beim Start und vor „Cover nachtragen“ auf: ersetzt, wo es ein speicherbares Bild gibt, sonst entfernt – das Buch zählt dann als „ohne Cover“. Entfernt wird nur, wenn das Internet nachweislich geht.
- Bestehende Cover werden nie überschrieben; die Funktion füllt nur leere.
- **Pseudo-Cover:** Eine Cover-Adresse ohne gespeichertes Bild zählt als „ohne Cover“ und wird wie oben aufgeräumt.

**Google-Bildersuche** (im Cover-Dialog unter „🔍 Google-Bildersuche“, im Bearbeiten-Modus als Knopf „🔍 Bildersuche“):
- **Ohne Einrichtung:** „Google Bilder öffnen ↗“ öffnet die Suche mit passendem Suchbegriff im neuen Tab. Dort ein Bild **anklicken** (große Vorschau rechts – die kleinen Bilder in der Trefferliste sind unscharf) und dann:
  - **PC:** Bild in die gestrichelte Fläche der App ziehen – oder Rechtsklick → **„Bild kopieren“** und in der App **Strg+V**. Auch „Bildadresse kopieren“ und kopierte Google-Links funktionieren; die App holt dann das Original.
  - **Handy:** Bild lange drücken → „Bild kopieren“, in der App auf **„📋 Aus Zwischenablage“** tippen (beim ersten Mal fragt der Browser um Erlaubnis) – oder in die gestrichelte Fläche tippen und „Einfügen“ wählen.
- Manche Webseiten geben ihre Bilder nicht zum Speichern heraus. Dann meldet sich die App mit einem Hinweis; „Bild kopieren“ statt „Bildadresse kopieren“ hilft in diesem Fall fast immer.
- **Warum ein eigener Tab?** Google erlaubt nicht, seine Suche in andere Apps einzubetten, und gibt die Treffer nicht an fremde Seiten heraus. Deshalb öffnet sich Google in einem eigenen Tab.
- **Direkt in der App (nur mit altem Schlüssel):** Wer schon einen Google-Schlüssel mit Suchmaschinen-ID hat (**Mehr → „Einstellungen & Über die App“** → „Google-Bildersuche“), sieht die Bilder als Treffer in der App. Google nimmt dafür keine neuen Nutzer mehr an und stellt den Dienst am 1. 1. 2027 ein.
- „Google Bilder“ gibt es außerdem als Suchseite unter „Suchseiten wählen“.

## Tabelle: filtern und sortieren

Unter den Spaltenüberschriften der Tabelle liegt eine **Filterzeile** (ein-/ausblendbar mit „Spaltenfilter“). Alle Filter wirken zusammen und zusätzlich zu Suche, Schlagwort und den Filter-Knöpfen.
- **Textspalten** (Titel, Autor, Verlag, Reihe, Schlagworte, Standort …): Text = enthält (Groß-/Kleinschreibung und Umlaute egal) · `!wort` = enthält nicht · `a | b` = oder · `=wort` = genau · `leer` / `!leer`.
- **Zahlen** (Jahr, Band, Seiten, Preis, Wert): `1990`, `>1990`, `<=20`, `1980-1990`, `leer`.
- **Datum** (Hinzugefügt, Gelesen): `2025`, `03.2025`, `>2024`, `2023..2025`, `leer` (= nie gelesen). Bei „Gelesen“ zählt jeder Lesedurchgang.
- **Auswahl** für Cover (mit/ohne), Status, Bewertung (ab n Sternen) und Lieblingsbuch.
- Ungültige Eingaben werden rot markiert und ignoriert. Esc leert ein Filterfeld.
- **Vorschläge:** Titel, Autor, Jahr, Verlag, Reihe, Genre, Schlagworte, Standort und „Fehlt“ schlagen beim Hineinklicken die vorhandenen Werte vor – die häufigsten zuerst, mit Anzahl. Es erscheinen nur Werte, die zu den übrigen Filtern passen (z. B. bei Status „Gelesen“ nur Autoren gelesener Bücher). Nach `|` kommt der nächste Vorschlag dazu, so wählst du mehrere Werte aus.

**Spalten anpassen:** „▦ Spalten“ blendet Spalten ein und aus (der Titel bleibt immer sichtbar). Die **Breite** änderst du, indem du in der Überschrift den rechten Rand einer Spalte ziehst; Doppelklick auf den Rand stellt die Standardbreite wieder her. „Breiten zurücksetzen“ gilt für alle Spalten. Der CSV-Export enthält immer alle Spalten.

**Mehrere Bücher auf einmal löschen:** Vorne in jeder Zeile steht ein Kästchen zum Ankreuzen. **Umschalt+Klick** kreuzt alles bis zum zuletzt angeklickten Buch an; das Kästchen in der Überschrift wählt **alle angezeigten** Bücher (praktisch zusammen mit einem Filter, z. B. „Ohne Cover“ oder einem Autor). Über der Tabelle erscheint dann „… ausgewählt“ mit **🗑 Löschen** – die App zeigt vorher, welche Bücher betroffen sind, und fragt nach. Wechselst du Filter oder Sortierung, wird die Auswahl aufgehoben. Weggegebene Bücher besser als „📦 Hatte ich mal“ markieren statt löschen.

**Dubletten finden:** **Mehr → „Dubletten prüfen“** zeigt Bücher mit gleicher ISBN (auch ISBN-10 = ISBN-13) oder gleichem Titel und Autor – außer wenn ISBN oder Band-Nr. verschieden sind, dann gelten sie als verschiedene Bände. Je Gruppe:
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

Im Bereich **Regal** baust du deine Regalwand nach und räumst die Bücher so ein, wie sie bei dir stehen.

- **Regalwand anlegen:** Name vergeben und einen Start-Aufbau wählen, z. B. „Zwei 2er-Würfel nebeneinander“ oder „4er-Würfel + 2er-Würfel“. Mehrere Wände (z. B. Wohnzimmer, Arbeitszimmer) sind möglich.
- **Aufbau ändern:** Die Wand besteht aus Spalten; in jeder Spalte stapelst du Würfel. „＋2er“ = Montana 6112 (B 69,6 × H 35,4 × T 30 cm, 2 Fächer), „＋4er“ = Montana 1112 (B 69,6 × H 69,6 × T 38 cm, 4 Fächer), „＋Lücke“ für freie Stellen. Mit ▲ ▼ ◀ ▶ verschieben, Farbe wählen, ✕ entfernen. Die Knöpfe stehen in einer Leiste **über** jedem Würfel, die Fächer bleiben frei sichtbar. Solange du baust, ist die Liste der einzuräumenden Bücher ausgeblendet und die Wand nutzt die ganze Breite; „✓ Fertig“ bzw. „✓ Aufbau fertig“ bringt alles zurück.
- **Einräumen:** Rechts (am Handy unten) stehen die noch nicht eingeräumten Bücher. Buch antippen, dann auf ein Fach tippen (kommt ans Ende) oder auf das Buch, vor das es soll. Am PC geht auch Ziehen mit der Maus.
- **Buchrücken gestalten:** Buchrücken antippen → **🎨 Rücken gestalten** (auch auf der Buchseite unter „Standort“ und im Bearbeiten-Modus). Mit Live-Vorschau stehend und liegend:
  - **Farbe** (oder „aus Cover“) und **Schriftfarbe** (automatisch, hell, dunkel, gold)
  - **Text-Anordnung:** hochkant, quer, beides oder kein Text; eigener Text für beide, Position des Quertexts (oben/unten)
  - **Leserichtung** (deutsch: von unten nach oben, englisch: von oben nach unten), **Schrift** und **Schriftgröße** (stufenlos von 40 bis 200 %; bei „Kein Text“ oder einem Foto ohne „Text trotzdem zeigen“ ausgegraut)
  - **Dicke** und **Höhe** in cm (sonst geschätzt)
  - **Eigenes Foto** des Rückens: ersetzt Farbe und Text; Querformat-Fotos werden automatisch aufgerichtet, die Dicke wird aus dem Seitenverhältnis berechnet. Auch per Drag & Drop oder Strg+V.
  - **Zurücksetzen** macht den Rücken wieder automatisch.
- **Hochkant:** Im Aufbau-Modus dreht ⟳ einen 2er-Würfel hochkant (35,4 × 69,6 cm, zwei Fächer übereinander) und wieder zurück. Bereits eingeräumte Bücher wandern mit (links → oben, rechts → unten).
- **Buchrücken antippen:** nach links/rechts schieben, in ein anderes Fach umstellen, herausnehmen oder das Buch öffnen – und:
  - **▬ Hinlegen (stapeln):** Das Buch liegt quer in der Reihe. Mehrere liegende Bücher nebeneinander in der Reihe werden automatisch zu einem Stapel.
  - **⇧ Oben auf die Reihe legen:** Das Buch liegt quer auf den stehenden Büchern. Mehrere aufgelegte Bücher stapeln sich; mit ▲/▼ änderst du die Reihenfolge.
  - **⇅ In die hintere Reihe:** für Doppelreihen. Die hintere Reihe erscheint leicht versetzt und abgedunkelt hinter der vorderen. Mit dem Knopf **„⇅ hinten“** im Fach holst du sie nach vorne, um dort einzuräumen oder Bücher anzutippen; **„⇅ vorne“** schaltet zurück. Hintere Bücher, die oben über die vordere Reihe hinausschauen, kannst du auch direkt antippen oder auswählen.
- **Wieder herausnehmen:** Buchrücken antippen → **„↩ Zurück zu ‚Noch nicht eingeräumt‘“**, am PC den Buchrücken einfach auf die Liste rechts ziehen, oder auf der Buchseite **„↩ Aus dem Regal nehmen“**. Die Liste zeigt alle noch nicht eingeräumten Bücher (nach Autor sortiert); beim Herunterrollen lädt sie weitere nach. Das Suchfeld darüber filtert sie – der Suchbegriff bleibt stehen, auch nach dem Einräumen und nach einem Neustart, und ein eingeräumtes Buch verschwindet sofort aus der Liste. Passen auch eingeräumte Bücher, holt **„… eingeräumte Bücher passen auch – zeigen“** sie dazu (mit Standort und ↩). **„Ganzes Fach leeren“** nimmt alle Bücher eines Fachs auf einmal heraus.
- **Beim Einräumen** (Buch ausgewählt) zeigt jedes Fach zusätzlich **„⇧ drauflegen“** und – solange es noch keine hintere Reihe hat – **„⇅ hinten“**.
- **Mehrere Bücher auf einmal umstellen:** oben **„☑ Auswählen“** drücken und die Bücher antippen (blau umrandet) – auch Bücher aus der Liste „Noch nicht eingeräumt“. **„☑ alle“** im Fach wählt die ganze Reihe. Danach in der Leiste: **„⇅ Nach hinten“**, **„⇅ Nach vorne“**, **„↔ In anderes Fach“** (dann auf ein Fach oder auf das Buch tippen, vor das sie sollen), **„↕ Gleiche Höhe“** (alle ausgewählten Rücken gleich hoch – häufigste, höchste oder niedrigste Höhe der Auswahl oder ein eigener Wert in cm) oder **„↩ Herausnehmen“**. Am PC kannst du einen ausgewählten Rücken auch ziehen – die anderen ausgewählten wandern mit, in ihrer Reihenfolge.
- **Darstellung:** Die Buchrücken sind symbolisch – die Breite wird aus der Seitenzahl geschätzt, die Farbe aus dem Cover. Jedes Fach ist innen ca. 33 × 33 cm; ist es rechnerisch voll (Reihe zu breit oder aufgelegter Stapel zu hoch), wird es rot umrandet.
- **Das echte Fach ist voll?** Buchrücken antippen → **„↔ Fach ist voll – auf ganze Breite verteilen“**. Die Bücher dieser Reihe werden dann gleichmäßig so breit gezeichnet, dass sie das Fach genau füllen (auch wenn sie rechnerisch zu breit wären). Selbst gemessene Dicken („🎨 Rücken gestalten“) bleiben dabei unverändert. Das gilt dauerhaft, auch wenn du Bücher dazustellst oder herausnimmst; **„↔ Wieder geschätzte Dicken“** schaltet es ab.
- **Gleich dicke Bücher (z. B. eine Reihe derselben Ausgabe):** Buchrücken eines Buchs antippen → **„📏 Diese Dicke (… cm) für die ganze Reihe“**. Alle anderen Bücher dieser Reihe (vorne, hinten oder oben aufgelegt) bekommen dieselbe Dicke; vorher fragt die App nach und sagt, wie viele schon eine eigene Dicke haben, die ersetzt wird. Die Dicke selbst stellst du vorher unter „🎨 Rücken gestalten“ ein – sonst gilt die geschätzte.
- **🔍 Lupe:** oben einschalten, dann am PC mit der Maus über die Rücken fahren bzw. am Handy den Finger auflegen und ziehen. Die Lupe zeigt das Fach stark vergrößert, darunter Titel und Autor des Buchs. Solange die Lupe an ist, verschiebt Ziehen am Handy die Lupe statt das Regal – zum Blättern die Lupe wieder ausschalten.
- Oben stehen **📷 Fach-Foto einlesen**, **☑ Auswählen** und **🔍 Lupe**; Gesamtansicht, Aufbau ändern, weitere Wand und Großansicht liegen unter **„⋯ Mehr“**. Eine eingeschaltete Ansicht bleibt als „✓ …“ oben sichtbar, ein Tipp darauf schaltet sie wieder aus. Die Erklärung zu den Symbolen steht unter dem Regal bei **„ⓘ So geht’s“**.
- **🗺 Gesamtansicht:** zeigt alle Regalwände nebeneinander auf einen Blick. Antippen, Einräumen, Auswählen und Lupe funktionieren dort genauso. Den Namen einer Wand antippen zeigt nur diese Wand. Die App merkt sich, ob die Gesamtansicht an ist.
- **Wände tauschen:** In der Gesamtansicht ◀ / ▶ neben dem Wandnamen antippen – die Wand tauscht den Platz mit ihrer Nachbarin. Oder unter **„🧱 Aufbau ändern“** „◀ Wand nach vorne“ bzw. „Wand nach hinten ▶“. Die Reihenfolge gilt auch für die Auswahlliste der Wände.
- **Mehr Platz fürs Regal:** Die Überschrift **„Noch nicht eingeräumt“** antippen klappt die Bücherliste ein (und wieder auf) – das Regal nutzt dann die ganze Breite. **„⛶ Großansicht“** nutzt am PC zusätzlich die ganze Fensterbreite. Beides merkt sich die App auf diesem Gerät.
- **Rückentitel maximieren:** Bücher auswählen (☑ Auswählen) → **„🔠 Rückentitel maximieren“** – die Schrift wird so groß, wie Breite und Länge des Rückens es erlauben, und der ganze Titel bleibt lesbar. Ist er dafür zu lang, steht der kurze Titel ohne Untertitel da; nur sehr lange Rückentexte werden wie gewohnt mit „…“ gekürzt. Mit derselben Auswahl stellt **„🔡 Rückentitel normal“** es zurück. Einzeln geht das auch im Buchrücken-Editor (Schriftgröße → „Max“). Bei Rücken mit Foto bleibt das Foto.
- **Vergrößern:** oben rechts stufenlos mit dem Regler (25–600 %, am PC) oder mit − / ＋; am Handy mit zwei Fingern auseinanderziehen, am PC mit Strg + Mausrad (oder auf dem Touchpad spreizen). Die Stelle unter den Fingern bzw. der Maus bleibt dabei stehen. **⤢** zeigt wieder alles.
- **Die Ansicht bleibt stehen:** Beim Einräumen, Auswählen, Ein- und Ausschalten der Lupe usw. bleibt das Fach, in dem du gerade arbeitest, auf seiner Höhe – das Regal springt nicht mehr nach oben.
- **Standort:** Auf jeder Buchseite steht, wo das Buch steht („Wohnzimmer · Spalte 1 · 4er-Würfel, Fach oben links · 3. Buch von links“), mit „Im Regal zeigen“. In der Tabelle gibt es eine Spalte „Standort“ und den Filter „Nicht eingeräumt“.
- Die Aufstellung wird mit der Sicherung exportiert und beim Import übernommen, wenn sie neuer ist.
- **🗂 Mehrere Aufstellungen:** Du kannst deine Bücher in mehreren Varianten einsortieren – z. B. „Nach Autoren“ und „Nach Farben“ – und zwischen ihnen wechseln. Unter **„⋯ Mehr“ → „🗂 Aufstellungen“** legst du eine neue an: **„📋 Kopie der jetzigen“** übernimmt alles, wie es gerade steht (dann umstellen); **„🧱 Gleicher Aufbau, leer“** nimmt dieselben Würfel ohne Bücher – zum Neu-Einsortieren. Gibt es mehr als eine Aufstellung, steht ihr Name oben im Regal; ein Tipp darauf öffnet die Liste mit **„Zeigen“** (wechseln), Umbenennen und Löschen. Umstellen, Einräumen und „Aufbau ändern“ gelten immer für die Aufstellung, die gerade zu sehen ist. Die Bücher selbst gibt es nur einmal; auf der Buchseite steht unter „Standort“ zusätzlich, wo das Buch in den anderen Aufstellungen steht. Alle Aufstellungen sind in Sicherung und Abgleich dabei.

## Fach-Fotos einlesen (viele Bücher auf einmal)

Unter **Buch hinzufügen → „Fach-Foto einlesen“**, unter **Mehr**, im **Regal → 📷 Fach-Foto einlesen** oder beim Antippen eines Buchrückens (**„Dieses Fach per Foto einlesen“**):

1. Ziel-Fach wählen (oder „nicht einsortieren“) und ein ganzes Fach von vorne fotografieren bzw. ein Foto wählen.
2. Die App erkennt alle Buchrücken von links nach rechts – **mit KI-Schlüssel in zwei Schritten:** erst nur die Lage aller Rücken (mit dem günstigen Modell Claude Haiku), dann wird **jeder Rücken einzeln** aus dem Foto in voller Auflösung ausgeschnitten, gerade gerückt, waagerecht gedreht und gelesen. So bleibt die Schrift auch bei 25–30 Büchern im Fach lesbar. Was ein Fach etwa kostet, steht vor dem Start bei „🤖 KI direkt“ (meist einige Cent, im Sammelauftrag die Hälfte).
   Erkannt werden auch liegende Bücher, Bücher oben auf der Reihe und eine hintere Reihe. CDs, Karten, Prospekte werden als „kein Buch“ erkannt und standardmäßig übersprungen.
3. Für jedes Buch sucht sie in DNB, Google Books und Open Library die passende Ausgabe (Verlag wie „dtv“ zählt mit).
4. **Prüfliste:** Foto mit nummerierten Rahmen, je Buch der ausgeschnittene Rücken, erkannter Titel/Autor/**Band** (änderbar, dann „🔎 Neu suchen“), Katalogtreffer zur Auswahl oder „nur erkannte Angaben“. Bücher, die du schon hast, werden erkannt und nur einsortiert.
   - **Claude wählt den Katalogtreffer** (mit KI-Schlüssel, abschaltbar unter „Über die App & Einstellungen“ → KI-Erkennung): Nach der Katalogsuche vergleicht Claude jeden Rücken mit den gefundenen Einträgen und ihren Covern – Farbe, Schrift und Verlagslogo müssen zur Ausgabe passen, Übersetzungen, Lernhilfen und andere Bände fallen heraus. Nur wenn Claude sicher ist und der Band stimmt, wird der Treffer automatisch gewählt (in der Auswahl mit 🤖 markiert). Sonst bleibt die Zeile gelb, Claudes Vermutung und der Grund stehen dabei – ein Tipp auf **„🤖 Vorschlag übernehmen“** genügt. Kostet ein paar Cent zusätzlich pro Fach (wird in den Einstellungen angezeigt).
   - **Websuche für Bücher ohne Treffer** (Standard aus, in denselben Einstellungen): Claude sucht im Internet nach Ausgabe und ISBN. Eine gefundene ISBN wird immer noch einmal im Katalog nachgeschlagen, bevor sie angeboten wird.
   - **„🔍 Unsichere Rücken genauer lesen“** (oben bei den gelb markierten): liest nur die unsicheren Rücken noch einmal einzeln. Ohne KI-Schlüssel erzeugt die App dafür ein Bild mit den nummerierten, waagerecht gedrehten Rücken (eine „Collage“) für deinen Claude-Chat.
   - **Sehr volle Fächer:** Bei mehr als etwa 20 Rücken schlägt die App vor, das Fach in zwei Hälften zu fotografieren.
   - **Ein Fach in mehreren Fotos:** Passt ein Fach nicht scharf auf ein Foto, setze beim Fotografieren den Haken **„Fach passt nicht auf ein Foto“**. Nach jedem Foto fotografierst du den nächsten Abschnitt rechts daneben – ein, zwei Bücher Überlappung sind gut –, dann **„✓ Fertig“**. Die App erkennt jedes Foto einzeln (auch im Sammelauftrag), setzt sie nebeneinander zu einer gemeinsamen Prüfliste zusammen und zählt Bücher am Übergang nur einmal: Das doppelte steht ohne Haken da, mit dem Hinweis „dasselbe Buch wie Nr. …“. Sind es wirklich zwei Exemplare, setze den Haken wieder. Beim Übernehmen kommen alle Bücher in der richtigen Reihenfolge ins Fach.
   - **Nachträglich zusammenfassen:** Unter „📥 Gespeicherte Fach-Fotos“ fasst **„🔗 Mit nächstem Foto zusammenfassen“** ein Foto mit dem folgenden zu einem Fach zusammen (das folgende ist die rechte Fortsetzung). **„✂ Trennen“** macht wieder einzelne Fotos daraus.
   - **Schnell abarbeiten:** Oben zählt die App, was wie sicher ist – **🟢 sicher**, **🔵 ohne Katalogtreffer** (Titel und Autor gelesen, aber keine ISBN gefunden), **🟡 mehrere Ausgaben** (welche ist es?) und **🔴 nicht lesbar / kein Buch?**. Ein Tipp auf eine Kategorie zeigt nur diese Bücher, nochmal tippen zeigt wieder alle. Bei jedem Buch steht das Zeichen neben der Nummer.
     - Den **Rücken antippen** zeigt ihn groß aus dem Originalfoto.
     - Bei unsicheren Büchern stehen die **Katalogtreffer mit Cover** darunter – antippen wählt die Ausgabe.
     - **„▦ Barcode“** scannt den Barcode auf der Rückseite: Dann ist das Buch per ISBN eindeutig, ohne die Liste zu verlassen.
     - **„🔵 Alle … ohne Katalogtreffer so übernehmen“** bestätigt alle blauen auf einmal.
     - **„🟢 … sichere übernehmen, Rest später prüfen“** legt die sicheren Bücher sofort an; der Rest bleibt am Fach-Foto gemerkt (unter „📥 Gespeicherte Fach-Fotos“). Beim Abschluss wird nichts doppelt angelegt, die schon übernommenen werden dann mit einsortiert.
   - **Nachfrage bei Unsicherheit:** Unsichere Rücken sind **gelb markiert** (im Foto mit „?“), oben steht, wie viele es sind – mit „Nur unsichere zeigen“. Gründe sind z. B.: Rücken schlecht lesbar, mehrere ähnliche Katalogeinträge, Band nicht im Katalog, oder dasselbe Buch zweimal im Foto. Entweder korrigieren und neu suchen, einen Katalogtreffer wählen – oder **„✓ Passt so“**. Beim Übernehmen fragt die App nach, solange noch etwas ungeprüft ist.
   - **Reihen mit Bänden** (z. B. „Weihnachtsgeschichten am Kamin 8“): Die Band-Nummer zählt. Ein Katalogtreffer wird nur automatisch gewählt, wenn er denselben Band nennt – sonst werden die erkannten Angaben mit Reihe und Band übernommen (ohne fremde ISBN). Verschiedene Bände werden nie zu „Weiteres Exemplar“.
   - **Zwei gleiche Bücher im Foto** werden nach deinem „✓ Passt so“ zu zwei Exemplaren – und gelten danach nicht als Dublette.
5. **Übernehmen:** Neue Bücher werden angelegt und in Reihenfolge ins Fach gestellt (liegend, oben drauf, hinten wie erkannt). Wahlweise ersetzt das den bisherigen Fach-Inhalt oder wird angehängt. Die **Buchrücken-Bilder** werden direkt aus dem Foto geschnitten, Dicke und Höhe aus dem Foto berechnet. Geschnitten wird aus dem Foto in voller Auflösung (die Fach-Fotos werden dafür mit bis zu 3000 Pixeln gespeichert). So bleiben die Rücken auch bei vielen schmalen Büchern im Fach scharf. Ein Rückenbild ist höchstens 1600 Pixel lang, damit Speicher und Sicherung klein bleiben. Die kleinen Vorschaubilder in der Prüfliste sind davon unabhängig.

**Fotos werden gespeichert – erkennen geht auch später oder am PC.** Jedes Fach-Foto bleibt in der App, bis es einsortiert ist (**Mehr → „Gespeicherte Fach-Fotos“; im echten Regal zeigt ein Hinweis, wie viele warten). So geht nichts verloren, auch wenn Android die App im Hintergrund schließt – beim nächsten Öffnen macht sie genau dort weiter, wo du warst.
- **💾 Nur speichern – später erkennen:** Ideal, um eine ganze Wand schnell abzufotografieren. Nach jedem Foto steht gleich das **nächste Fach** in der Auswahl – also nur „📷 Nächstes Fach fotografieren“ antippen. Erkennen und einsortieren dann in Ruhe, z. B. am PC.
- **Zum PC bringen:** Mit dem Abgleich über deinen eigenen Server kommen die Fotos (samt Fach) automatisch auf den PC. Ohne Server: Sicherung exportieren und am PC importieren – offene Fotos sind darin enthalten.
- In der Übersicht je Foto **„Erkennen & einsortieren“** (Fach lässt sich dort noch ändern). Wurde ein Foto schon erkannt, aber noch nicht fertig geprüft, steht dort **„Prüfen & einsortieren“** – ohne neue Erkennung. Eingeräumte Fotos wandern nach „Erledigt“ und können gelöscht werden; die Bücher bleiben.
- **Viele Fächer auf einmal erkennen (mit KI-Schlüssel):** Oben in „📥 Gespeicherte Fach-Fotos“ schickt **„🤖 Alle … Fotos erkennen“** alle noch nicht erkannten Fotos in einem Rutsch an Claude – als Sammelauftrag zum **halben Preis**. Meist ist alles in unter einer Stunde fertig; die App muss dabei nicht offen bleiben und sieht regelmäßig nach („Jetzt nachsehen“ fragt sofort). Danach führt **„✓ … erkannte Fächer der Reihe nach prüfen & einsortieren“** Fach für Fach durch die Prüfliste: Übernehmen, und das nächste Fach öffnet sich von selbst. Fehlende Cover trägt die App am Ende für alle auf einmal nach. Klappt der Sammelauftrag nicht, bietet die App an, die Fotos einzeln nacheinander zu erkennen (normaler Preis, die App bleibt dabei offen).
  **So erfasst du eine ganze Bibliothek:** 1. Alle Fächer mit „💾 Nur speichern“ abfotografieren (Fach wählen, Foto, „Nächstes Fach fotografieren“). 2. Am PC „🤖 Alle Fotos erkennen“. 3. Später „der Reihe nach prüfen“ – nur gelb Markiertes braucht Aufmerksamkeit.
- **Teilen → Bücherregal (Android, installierte App):** Fotos aus der Kamera-App oder Galerie lassen sich über „Teilen“ direkt an die App schicken; sie landen in der Übersicht (Fach dort zuordnen). Ebenso kann Claudes Antwort per „Teilen → Bücherregal“ zurückgeschickt werden.

**Erkennung – zwei Wege** (wählbar beim Fach-Foto):
- **💬 Über deinen Claude-Chat** – nutzt dein Claude-Abo, ohne Zusatzkosten: Die App bereitet Foto und Auftrag vor. Am Handy „📤 An Claude teilen“ und die Claude-App wählen; steht der Auftrag dort nicht schon im Eingabefeld, lange ins Feld tippen → „Einfügen“ (oder „Auftrag kopieren“ und das Foto in einem neuen Chat auf claude.ai anhängen). Am PC öffnet „📋 Auftrag kopieren & Claude öffnen“ claude.ai und legt den Auftrag gleich in die Zwischenablage. Claude antwortet mit einem Codeblock – den mit dem Kopieren-Knopf kopieren und zur App zurückkehren: Die App übernimmt die Antwort dann meist von selbst. Fragt der Browser beim ersten Mal, ob die Seite die Zwischenablage lesen darf, „Zulassen“ wählen. Klappt es nicht von selbst, „📥 Antwort einfügen“ antippen oder die Antwort ins Feld einfügen. Eine alte Antwort, die schon übernommen wurde, verwendet die App nie ein zweites Mal. Das funktioniert genauso für einzelne Cover („💬 Mit Claude-Chat erkennen“ in der Suche nach einem Cover-Foto).
- **🤖 KI direkt (API-Schlüssel)** – vollautomatisch, siehe unten.

**KI direkt:** Für den vollautomatischen Weg braucht es die **KI-Erkennung** mit einem eigenen API-Schlüssel von Anthropic (**Mehr → „Einstellungen & Über die App“** → „KI-Erkennung“). Abgerechnet wird pro Foto über dein eigenes API-Konto, meist wenige Cent. Der Schlüssel bleibt nur in deinem Browser und ist nicht in der Sicherung. Ohne Schlüssel geht es über deinen Claude-Chat (siehe oben). Die frühere einfache Texterkennung im Browser gibt es nicht mehr – sie war zu ungenau.

Tipps fürs Foto: gerade von vorne, ganzes Fach im Bild, gutes Licht, kein Blitz-Spiegeln auf Folien.

## 4. Handy und PC abgleichen

Jedes Gerät hat sein eigenes Regal. So bringst du sie zusammen:

1. Auf dem Handy: **Mehr → „Sicherung exportieren“** → die Datei an dich selbst schicken (Mail, Messenger, Cloud-Ordner).
2. Am PC: **Mehr → „Sicherung importieren“** → Datei wählen.

Die Bücher werden zusammengeführt: Neue kommen dazu, bei Änderungen gewinnt die jeweils neuere, Gelöschtes wird auch drüben gelöscht. Das funktioniert in beide Richtungen.

### Automatisch abgleichen über den eigenen PC (optional)

Statt Dateien hin- und herzuschicken, kann sich die App über eine kleine Datenbank (CouchDB) auf deinem PC selbst abgleichen –
ohne Cloud, auch unterwegs, sobald der PC an ist. Einrichtung Schritt für Schritt: **`ABGLEICH-EINRICHTEN.md`**.
Danach: **Mehr → „Abgleich mit eigenem Server“**. Das **⟳** oben zeigt, ob gerade abgeglichen wird (rot = Problem, antippen).
Freunde, die keinen eigenen Server haben, nutzen die App einfach wie bisher.

## 5. Sicherheit deiner Daten

- Die Daten liegen im Speicher des Browsers. **Wenn du die Browserdaten/Websitedaten löschst, ist das Regal weg.** Die App erinnert dich alle 14 Tage an eine Sicherung.
- Die Sicherungsdatei (`.json`) enthält alles inklusive Cover-Fotos. Bewahre sie gut auf.
- **Am PC am bequemsten:** **Mehr → „Automatische Sicherung“** (Chrome/Edge). Ein Stand pro Tag, die letzten 14 Tage bleiben. Ordner auf einem USB-Stick oder einer externen Festplatte wählen.
- **Auch mit Abgleich wichtig:** Der Abgleich verteilt jede Änderung auf alle Geräte – auch ein versehentliches Löschen. Nur eine ältere Sicherung holt so etwas zurück.
- „Als CSV für Excel exportieren“ (unter **Mehr**) gibt dir eine Tabelle zum Weiterverarbeiten.

## 6. An Freunde weitergeben

Schick ihnen einfach deine Adresse (z. B. `https://DEIN-NAME.github.io/buecherregal/`). Jede Person hat ihr **eigenes, privates Regal** auf ihrem Gerät – niemand sieht die Bücher der anderen, auch du nicht.

## Nichts geht verloren

- **Prüflisten werden laufend gemerkt.** Beim Fach-Foto stehen Auswahl, Korrekturen und „✓ Passt so“ am Fach-Foto. Schließt Android die App (etwa während die Kamera offen ist) oder schließt du die Liste, geht es beim nächsten Öffnen genau dort weiter, auch mitten in „der Reihe nach prüfen“. Sonst unter **Mehr → „Gespeicherte Fach-Fotos“ → „Prüfen & einsortieren“. Mit dem Abgleich kommt der Stand auch auf den PC.
- **„Prüfen & speichern“** sichert den Entwurf samt Cover- und Rückenfoto. Nach einem Neustart steht unten „Du warst gerade dabei, „…“ zu erfassen – weitermachen?“.
- **Schließen:** Am Handy schließt nur ✕, Tippen neben das Fenster schließt nichts mehr. Am PC schließt ein Klick daneben; gibt es ungespeicherte Änderungen, fragt die App vorher. Die **Zurück-Taste** am Handy schließt das offene Fenster (mit Nachfrage) statt die App.
- Hinweise, die von selbst auftauchen (z. B. „In der Zwischenablage: …“), ersetzen nie eine offene Liste.

## Erkennungsprotokoll

Jede Erkennung schreibt ein Protokoll: Fach-Foto, Cover-Foto, Barcode, Titelsuche, Titelliste und Stapel. Es zeigt, was die KI gelesen hat (rohe Antwort, Modell, Bildgröße, ob die Antwort abgeschnitten wurde, Dauer), welche Kataloge wie geantwortet haben (Treffer, Fehler, Zeitüberschreitung, gesperrt bzw. Kontingent erschöpft) und warum ein Treffer gewählt wurde oder keiner. Du findest es in jeder Prüfliste unter **„🧾 Protokoll anzeigen / teilen“** und im **Mehr** → „🧾 Erkennungsprotokoll“. „📤 Teilen“ bzw. „⬇ Als Datei“ erzeugt eine JSON-Datei, praktisch zum Weitergeben, wenn etwas nicht klappt. Gespeichert werden die letzten 30 Läufe, nur auf diesem Gerät, nicht in Sicherung oder Abgleich. Dein KI-Schlüssel und andere Zugangsdaten stehen nie darin.

**Mit eigenen Fotos messen (am PC, für Fortgeschrittene):** `npm run eval` wertet echte Fach-Fotos aus, wie gut Rücken, Titel und Katalogtreffer erkannt werden. Wie du Fotos und die erwarteten Bücher anlegst, steht in der `README.md` unter „Auswertung der Fach-Foto-Erkennung“.

## Gut zu wissen

- **Neue Version:** Wurde die App aktualisiert, erscheint unten „Neue Version der App ist da“. „Jetzt aktualisieren“ lädt sie neu; mit ✕ geht es später beim nächsten Öffnen.

- **Offline:** Nach dem ersten Öffnen mit Internet startet die App auch ohne Netz – sofort, auch bei schlechtem Empfang (die App wartet nicht auf den Server). Ansehen, Suchen in den eigenen Büchern, Notizen, Bewertungen, Regal und Tabelle funktionieren offline. Alle Cover sind gespeichert und deshalb auch offline da.
- Erfassen braucht Internet (für Buchdaten und Cover); ebenso Abgleich und Sicherung auf den Server.
- **Updates:** Eine neue Version lädt die App im Hintergrund; danach erscheint „Neue Version der App ist da“ → „Jetzt aktualisieren“.
- Diktieren (🎙) gibt es in Chrome, Edge und Safari. Sonst geht das Mikrofon der Handy-Tastatur.
- Cover-Foto ohne KI-Schlüssel: Titel eintippen oder „💬 Mit Claude-Chat erkennen“.
- **Kataloge schonen:** Die App merkt sich Suchergebnisse eine halbe Stunde („Neu suchen“ fragt nicht doppelt), fragt die DNB nacheinander statt gleichzeitig und lässt einen Katalog, der „zu viele Anfragen“ meldet, eine Weile aus (DNB 10 Minuten, Google 1 Stunde). Bei erkannten Rücken und Titellisten sucht sie gezielt nach Titel und Autor und lockert die Suche nur, wenn nichts gefunden wird.
- Google Books teilt ohne Schlüssel ein kleines Kontingent mit allen Nutzern und antwortet dann oft nicht. Ist es erschöpft, zeigt die App oben einen Hinweis mit „Schlüssel eintragen“. Abhilfe: unter **Mehr → „Einstellungen & Über die App“** einen eigenen kostenlosen Google-Books-Schlüssel eintragen (Anleitung steht dort). Die DNB braucht keinen Schlüssel.
- Klappentexte liefern vor allem Google Books und Open Library; die DNB liefert sehr genaue Ausgabedaten, aber meist keinen Klappentext.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Die App-Seite |
| `app.js` | Die gesamte Logik |
| `style.css` | Aussehen |
| `sw.js` | Offline-Fähigkeit |
| `manifest.webmanifest`, `icons/` | Installation als App |
