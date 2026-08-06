# Preisempfehlung Deutschland — Source

Stand 6. August 2026, überarbeitet gegen `07a5c5cfa`.
Source for `rateloop-preisempfehlung-deutschland-2026-08.docx`. Intern.

Die Fassung vom 4. August war in der Hauptsache richtig — der öffentliche $-29-Anker
gehört gestrichen — und wurde gegen ein internes Papier geprüft, das das Gegenteil
empfahl. **Die Prüfung ist zugunsten dieses Dokuments ausgegangen; das widersprechende
Papier ist entfernt.** Preis wird ab jetzt hier und im
[Business Plan](../business-plan.md) entschieden, nirgends sonst.

Zwei Zahlen wurden gegenüber der Fassung vom 4. August korrigiert, beide nach oben.

## 1. Entscheidung

**Öffentlich sichtbar: Sandbox € 0 und Founding Assurance Pilot € 2.500 netto.
Kein veröffentlichter Abopreis, bis drei Piloten abgeschlossen sind. Danach € 1.200/Monat.**

Alle Preise **netto zzgl. 19 % USt.**, Rechnung in EUR, Zahlung per SEPA-Überweisung.

| | Preis | Agents | Gruppen | Aufbewahrung |
| --- | --- | --- | --- | --- |
| Sandbox | € 0 | 1 | 1 | 6 Monate |
| **Founding Pilot** | **€ 2.500 netto / 6 Wochen** | 3 | 5 | 12 Monate |
| **Assurance** | **€ 1.200/Monat, jährlich vorausbezahlt (€ 14.400)** | 3 | 5 | 24 Monate |
| **Assurance+** | **€ 2.500/Monat (€ 30.000)** | 10 | 15 | 60 Monate |

## 2. Warum der öffentliche $-29-Anker weg muss

1. **Seine eigene Bedingung ist nicht erfüllt.** Er sollte bleiben, „solange die
   angezeigten Grenzen und der Checkout-Zustand stimmen". Beides stimmt nicht.
2. **Die Karte widerspricht sich selbst.** Sie zeigt immer $29, aber der Button wechselt auf
   „Pilotprojekt anfragen", sobald Self-Serve-Checkout deaktiviert ist — was die
   Betriebsregeln vorschreiben. Der Interessent sieht **ein $-29-Preisschild, dessen einzige
   Handlung ein € 2.500-Pilot ist.**
3. **Kein Wettbewerber in der Kategorie veröffentlicht Preise.** Vanta, Drata, Secureframe,
   OneTrust, Credo AI, Holistic AI — und der nächstliegende Vergleich, das Münchner trail,
   verkauft stattdessen einen strukturierten Proof of Concept.
4. **$29 ist kein Anker, von dem man rabattiert.** Es ist ein Nettopreis, den der Einkauf
   zitieren kann, und er macht aus € 2.500 einen 86-fachen Aufschlag mit Begründungspflicht.
5. **Der Verkäufer ist eine deutsche UG.** USD-Preise gegenüber deutschen Käufern sind ein
   vermeidbarer Glaubwürdigkeitsverlust.
6. **PAngV-Randrisiko.** Die Preisangabenverordnung bindet Angebote gegenüber Verbrauchern,
   aber ein Gericht hat entschieden, dass bei einem für jedermann zugänglichen Online-Angebot
   davon auszugehen ist, dass es auch Privatkunden anspricht, solange der Zugang nicht
   technisch beschränkt ist. Ein öffentlicher Preis ohne Brutto-/USt-Angabe trägt damit ein
   — kleines, aber unnötiges — Abmahnrisiko.

## 3. Marktbeleg für € 2.500

| Referenz | Preis |
| -------- | ----- |
| Deutsche Hinweisgeber-Compliance-SaaS (Commodity-Boden) | € 45–97/Monat |
| Externer DSB — ein benannter Mensch mit Haftung | € 125–450/Monat |
| Matproof, EU-gehostete Compliance-Plattform | € 480 / € 1.200 pro Monat |
| Proliance ISMS Core | € 1.000/Monat |
| Deutscher AI-Act-Readiness-Scan (Festpreis) | ab € 1.950 netto |
| Deutsches AI-Act-Compliance-Paket (Festpreis) | € 4.500 netto |
| Deutsche AI-Act-Implementierungsprojekte | € 25.000–120.000 |

**€ 2.500 liegt zwischen dem € 1.950-Scan und dem € 4.500-Festpreispaket, bei sechs Wochen
Laufzeit — marktkonform und eher am unteren Rand.** Eine Erhöhung auf € 3.500 wäre gegen
diese Vergleiche vertretbar; belassen bei € 2.500 für die ersten drei Abschlüsse, weil
Referenzen momentan mehr wert sind als Marge.

## 4. Korrektur 1 — das € 249-Abo entfällt

**[GEÄNDERT gegenüber dem 4. August.]** Die frühere Empfehlung sah € 249 / € 799 / ab
€ 30.000 vor. € 249 wird gestrichen und € 799 durch € 1.200 ersetzt.

- Bei € 249 liegt der Break-even bei **24–30 Kunden**. Ein Operator erreicht das nicht.
- Ein Sechs-Wochen-Pilot zu € 2.500 impliziert **€ 1.667 monatlichen Wert**, also das
  6,7-fache eines € 249-Abos. Beide Preise können nicht gleichzeitig richtig sein.
- Die 50-%-Anrechnung von € 1.250 wäre bei € 2.490 Jahreswert **die halbe erste
  Jahresrechnung**. Bei € 14.400 sind es 8,7 %.
- Deckungsbeitrag: bei € 249 kippt die Marge schon ab **2,5 Supportstunden im Monat** ins
  Minus. Ein einziger deutscher Security-Fragebogen — acht Stunden, und er kommt — frisst
  drei Monate.

**€ 1.200 ist nicht der Wunschpreis, sondern der niedrigste Preis, bei dem Break-even bei
erreichbarer Kundenzahl überhaupt möglich ist:** fünf Kunden statt vierundzwanzig.

€ 249 bleibt als interner Boden für ein echtes Self-Serve-Angebot, falls Self-Serve je
ausgeliefert wird. Es ist nicht das Ziel einer Pilotkonversion.

## 5. Korrektur 2 — die Plattformgebühr ist 5–9 %, nicht 7,5 %

**[GEÄNDERT.]** Die Fassung vom 4. August nannte „rund 7,5 %" für künftige bezahlte Panels.
Der Code erzeugt diese Zahl an keiner Stelle. Die Gebühr beträgt **10 % der Basisprämie**,
bei einer on-chain garantierten Untergrenze von 80 % für Prüfende. Bezogen auf das, was der
Kunde tatsächlich zahlt, ergibt das **9,09 %**, wenn die Versuchsreserve ungenutzt bleibt,
und **5,26 %**, wenn sie vollständig verbraucht wird.

**Wichtig für jede künftige Preisdiskussion: der ausgelieferte Vertrag deckelt die Gebühr
bei 20 %.** Eine Empfehlung von „15–25 % Service Fee" verletzt diesen Deckel am oberen Rand
und erforderte ein neues Contract-Deployment mit vollständig neuem Deployment-Key über App,
Indexer, Keeper und Datenbank. Das stand bisher nirgends.

Zur Einordnung: Prolific nimmt 42,8 % Plattformgebühr. Bei 9,09 % ist RateLoop eine
Abwicklungsschnittstelle, keine Dienstleistungsmarge. Wer Prüfende sucht, prüft, schult und
qualitätssichert, verdient daran nicht — und der Deckel verhindert die Korrektur.

## 6. Was nicht gesagt wird

Keine Aussage zu deutscher Datenresidenz als Garantie, zu Compliance, zu bezahlten
Netzwerk-Panels oder zu Enterprise-SLA vor tatsächlicher Lieferfähigkeit.

Die Entscheidungs-Allowance von 25/250 nicht wiederbeleben, solange sie nicht systemweit
durchgesetzt ist. **Präzisierung [GEÄNDERT]:** Agent- und Gruppengrenzen **sind**
durchgesetzt und dürfen zugesagt werden. Nur die Entscheidungszahl ist es nicht — und einem
zahlenden Workspace wird dauerhaft „0 von 250" angezeigt, was vor dem ersten zahlenden
Kunden zu beheben ist.

Kein Self-Serve-Checkout, bis Billing und Business Verification bewiesen sind.

## 7. Abrechnung in der Zwischenzeit

Das Produkt kann **keine EUR-Rechnung stellen und kein SEPA annehmen** — Preise sind
USD-fest verdrahtet und Vorauszahlungen verlangen eine US-Banküberweisung.

**Das ist kein Hindernis für den Pilotpreis, sondern der Plan.** € 2.500 werden über ein
unterschriebenes Auftragsformular verkauft und von der Hawig Ventures UG direkt in EUR mit
19 % USt. in Rechnung gestellt, Zahlung per SEPA außerhalb des Produkts. Dafür ist kein
Zeile Billing-Code nötig.

Vorher zu erledigen:

- **USt-IdNr. ins Impressum** — Pflicht nach § 5 Abs. 1 Nr. 6 DDG und Voraussetzung für
  jede EU-B2B-Rechnung.
- **Rechnungsvorlage nach § 14 UStG** mit allen zehn Pflichtangaben.
- Bei EU-Kunden außerhalb Deutschlands: **§ 14a** — Rechnung bis zum 15. des Folgemonats,
  **beide USt-IdNr.** und der Hinweis **„Steuerschuldnerschaft des Leistungsempfängers"**;
  dazu die quartalsweise Zusammenfassende Meldung bis zum 25.
- **USt-IdNr. des Kunden über die qualifizierte Bestätigungsabfrage des BZSt prüfen** und
  die Antwort ablegen. Fällt sie später aus, kann das Finanzamt die Leistung als
  steuerpflichtig behandeln und 19 % aus bereits vereinnahmtem Entgelt festsetzen.
- **Bei einer USD-Rechnung mit deutscher USt. den Steuerberater fragen.** Die Umrechnung
  des Steuerbetrags ist ungeklärt — ein weiteres Argument für EUR.

E-Rechnung ist noch kein Blocker: empfangen müssen deutsche Unternehmen seit dem
1. Januar 2025, ausstellen erst ab 2027 beziehungsweise 2028. Eine PDF-Rechnung mit
Zustimmung des Empfängers ist 2026 zulässig.

**EUR/SEPA im Code erst nach drei bezahlten Piloten bauen** — dasselbe Tor wie für die
Veröffentlichung der Abopreise.

## 8. Das Experiment

Zehn qualifizierte Interessenten, identischer € 2.500-Zuschnitt, **kein Reflexrabatt**,
jedes Nein nach Grund kodiert: Preis / fehlender Sicherheitsnachweis / fehlende Integration
/ keine Dringlichkeit / kein Verantwortlicher / keine freigebbaren Daten / Betriebsrat.

- **Drei oder mehr Abschlüsse** → € 1.200 veröffentlichen.
- **Ein oder zwei** → das ICP ändern, nicht den Preis.
- **Keiner** → die Kategorie überzeugt nicht, und ein billigeres Abo löst das nicht.

## 9. Ungeprüft — vor Verwendung bestätigen

- **BAFA-Förderung „unternehmerisches Know-how"**: berichtet werden 50–80 % Zuschuss auf
  eine Bemessungsgrundlage bis € 3.500. Träfe das zu, läge ein € 2.500-Pilot vollständig in
  der geförderten Spanne — ein starker Mittelstandshebel. **Nicht verifiziert.**
- **Freigabeschwellen von Abteilungsleitern** im Mittelstand. Die kursierenden Zahlen
  (€ 5.000 / € 25.000) haben keine belastbare Quelle. Den € 2.500-Preis nicht damit
  begründen, sondern aus der eigenen Kundenentwicklung.
- Interne Ausgabenlimits einer Prokura wirken ohnehin **nicht gegenüber Dritten** — ein
  darüber unterschriebener Vertrag bindet das Unternehmen trotzdem.
