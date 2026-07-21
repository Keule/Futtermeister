# Futtermischungs-Rechner

Lokale Webanwendung zur Berechnung des Nährstoffgehalts einer Futtermischung aus einer hochgeladenen Excel-Nährstofftabelle.

## Enthaltene Funktionen

- Import von `.xlsx` und `.csv`
- automatische Suche nach dem Tabellenblatt und der Kopfzeile
- Erkennung der vollständigen PDF-/Excel-Extraktionsstruktur der Futtermitteltabelle mit 227 Trockenmasse-Datensätzen
- flexible Erkennung der Spaltenköpfe, z. B. `Futtermittel`, `TM [g]`, `XP [g]`, `ME [MJ]`, `Ca [g]`
- bevorzugte Verwendung der Bezugsbasis `Trockenmasse`
- beliebig viele Mischungskomponenten
- Berechnung je Tier und Tag:
  - Frischmasse und Trockenmasse
  - XF, aNDF, ADF, XP, nXP, RNB
  - NEL, ME, Stärke/Zucker, beständige Stärke, Rohfett
  - Ca, P, Mg, Na und K
  - XP-gewichteter UDP-Anteil
  - Ca:P-Verhältnis und Futterkosten
- Ergebnisse als Gesamtmenge, je kg Frischmasse und je kg Trockenmasse
- Skalierung auf Tierzahl und Fütterungstage
- eigene Analysewerte pro Komponente
- Zielwertkontrolle mit frei wählbaren Mindest- und Höchstwerten
- Import einer Sollwerttabelle für Tiergruppe, Gewicht, optionales Zunahmeziel und Nährstoffbedarf
- automatische Auswahl des nächstpassenden Sollwertsatzes für Bullen, Färsen, Kühe oder Kälber
- Rezeptspeicherung im Browser
- CSV-Export der Mischung und Ergebnisse

## Start unter Windows

1. Python 3.11 oder neuer installieren.
2. `start_windows.bat` doppelklicken.
3. Nach dem Start im Browser `http://127.0.0.1:8000` öffnen.

Beim ersten Start werden die benötigten Python-Pakete in einer lokalen virtuellen Umgebung installiert.

## Start unter Linux

```bash
chmod +x start_linux.sh
./start_linux.sh
```

Danach `http://127.0.0.1:8000` öffnen.

## Start mit Docker

```bash
docker compose up --build
```

Danach `http://localhost:8000` öffnen.

## GitHub Pages

Die App enthält zusätzlich eine statische Variante im Ordner `docs/`. Diese Version läuft ohne Python-Backend direkt im Browser und kann über GitHub Pages veröffentlicht werden.

Vorgehen:

1. Projekt in ein GitHub-Repository legen.
2. Den Ordner `docs/` mit einchecken.
3. In GitHub unter `Settings → Pages` auswählen:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/docs`
4. Danach ist die App unter `https://<name>.github.io/<repository>/` erreichbar.

Die statische Version liest `.xlsx`-Dateien im Browser mit SheetJS. Die hochgeladenen Futtermittel- und Sollwerttabellen werden nicht an GitHub übertragen.

## Erwartete Excel-Spalten

Mindestens erforderlich:

- `Futtermittel`
- `TM [g]`
- mehrere Nährstoffspalten

Unterstützte Hauptspalten:

`Abschnitt`, `Gruppe`, `Nummer`, `Futtermittel`, `Ausprägung`, `Bezugsbasis`, `TM [g]`, `XF [g]`, `aNDF / aNDFom [g]`, `ADF / ADFom [g]`, `XP [g]`, `nXP [g]`, `UDP [%]`, `RNB [g]`, `NEL [MJ]`, `ME [MJ]`, `XS+XZ [g]`, `bXS [g]`, `XL [g]`, `Ca [g]`, `P [g]`, `Mg [g]`, `Na [g]`, `K [g]`.

Die mitgelieferte Beispieldatei liegt unter `sample_data/Futtermittelnaehrstofftabelle.xlsx`, kann direkt über die Weboberfläche heruntergeladen werden und wird im Importtest mit exakt 227 Trockenmasse-Datensätzen erkannt.

## Erwartete Sollwert-Spalten

Eine Sollwerttabelle kann als `.xlsx` oder `.csv` geladen werden. Mindestens erforderlich:

- `Tiergruppe`
- `Gewicht kg`
- eine oder mehrere Nährstoffspalten

Optional:

- `Zunahme g/d`

Unterstützte Sollwertspalten sind:

`TM kg`, `aNDF g`, `XF g`, `XP g`, `nXP g`, `RNB g`, `ME MJ`, `NEL MJ`, `Ca g`, `P g`, `Mg g`, `Na g`, `K g`.

Die mitgelieferte Beispieldatei `sample_data/Sollwerte_Rinder.xlsx` enthält aus den vorhandenen Rationsunterlagen extrahierte Bedarfssätze für Mastbullen, Färsen/Jungvieh und ein Kuh-Beispiel. Nach dem Laden wählt die App anhand von Tiergruppe, Gewicht und Zunahmeziel den nächstpassenden Datensatz und trägt die Werte als Mindest-Sollwerte in die Zielwertkontrolle ein.

## Rechenweg

Für jede Komponente gilt:

```text
Trockenmasse [kg] = Frischmasse [kg] × TM [g/kg FM] ÷ 1000
Nährstoffmenge [g oder MJ] = Trockenmasse [kg] × Tabellenwert je kg TM
```

UDP wird nicht arithmetisch gemittelt, sondern nach dem Rohproteinbeitrag gewichtet:

```text
UDP der Mischung [%] = Summe(XP-Menge × UDP %) ÷ Summe(XP-Menge)
```

## Abgrenzung

Die Version 1.0 berechnet und kontrolliert Rationen. Eine automatische kostenoptimierte Rationsfindung mit Nebenbedingungen (Solver) ist noch nicht enthalten.

## Tests

```bash
python tests/test_parser.py
node tests/test_calc.js
```
