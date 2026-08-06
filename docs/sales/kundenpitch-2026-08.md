# Kundenpitch Deutschland — Foliensource

Stand 6. August 2026. Source for `rateloop-deutschland-kundenpitch-2026-08.pptx`.
Neun Folien, schwarzer Grund, Space Grotesk, Vierfarb-Spektrum, wie gehabt.

Änderungen gegenüber der gebauten Fassung sind mit **[GEÄNDERT]** markiert und in
[README.md](README.md) begründet.

---

## 01 — Titel

> **RateLoop**
>
> RateLoop macht aus verteilten Freigaben einen klaren Entscheidungs- und Evidenzpfad.
>
> Ein Workflow. Sechs Wochen.

*Notiz:* Nicht mit einem pauschalen AI-Act-Countdown eröffnen. Die Hochrisiko-Pflichten
wurden durch die Verordnung (EU) 2026/1744 auf den **2. Dezember 2027** verschoben. Wer
im August 2026 mit einer Hochrisiko-Frist verkauft, wirkt bei jedem Gegenüber mit
kompetenter Rechtsabteilung uninformiert. Was gilt: Art. 50 Transparenz seit dem
2. August 2026, und das deutsche KI-Marktüberwachungsgesetz ist am 29. Juli 2026 in Kraft
getreten; die Bundesnetzagentur nimmt ihre Rolle als koordinierende
Marktüberwachungsbehörde mit Beschwerdestelle und KI-Servicedesk **mit voller Wirkung ab
dem 2. August 2026** wahr. Wer die beiden Daten verwechselt, verliert genau bei dem
Gegenüber, das diese Folie überzeugen soll.

## 02 — Ausgangslage

> **KI wird produktiv. Die Freigabe bleibt oft unsichtbar.**
>
> Die deutsche Mittelstandsrealität ist nicht zu wenig KI — sondern zu wenig belastbare
> Entscheidungsevidenz.

Kennzahlen (Bitkom 2026, 604 Unternehmen ab 20 Beschäftigten): KI-Einsatz **41 %**
(Vorjahr 17 %), **48 %** planen den Einsatz.

*Notiz — ehrlich bleiben:* In derselben Erhebung nennt **niemand** „fehlende
Nachweisbarkeit der menschlichen Prüfung" als Hemmnis. Genannt werden Datenschutz (77 %),
Fachkräftemangel (70 %), Kosten (58 %), unklare Anwendungsfälle (51 %). Diese Folie
beschreibt eine Lücke, die der Kunde noch nicht als Problem formuliert hat. Wenn im
Gespräch klar wird, dass er sie auch nach Nachfrage nicht als Problem sieht, ist er nicht
der richtige Kunde — weitergehen, nicht überreden.

## 03 — Vorher / Nachher

> **Von Chat-Nachrichten zu einem belastbaren Prüfpfad**

| HEUTE | MIT RATELOOP |
| ----- | ------------ |
| Verteilt und schwer belegbar | Policy und Prüffrage sind vor der Zuweisung festgeschrieben |
| Freigabe in Chat, Mail, Ticket | Urteile werden getrennt erfasst — Prüfende sehen die Antworten der anderen nicht |
| Begründung rekonstruierbar nur aus Erinnerung | Go / Überarbeiten / Stop, Gründe und Abweichung werden aufgezeichnet |

Alle drei Zeilen sind gegen den Code geprüft und belastbar.

## 04 — Ablauf **[GEÄNDERT]**

> **Ein kurzer Prozess, der vor der Ausgabe entscheidet**

1. **Policy setzen** — Prüffrage, Optionen und Begründungspflicht werden festgeschrieben.
2. **Prüfen lassen** — benannte, eingeladene Prüfende urteilen unabhängig voneinander.
3. **Entscheiden** — die verantwortliche Person entscheidet Go, Überarbeiten oder Stop.
4. **Evidenz liefern** — ein **rekonstruierbares Evidenzpaket** für Nachvollzug und Prüfung.

**[GEÄNDERT]** Schritt 04 hieß „Signiertes Paket für Rekonstruktion und Prüfung". Die
Signatur existiert technisch, ist aber als öffentliche Aussage gesperrt, solange der
Signaturpfad nicht extern erprobt ist. „Rekonstruierbar" ist die Formulierung, die Folie 06
ohnehin verwendet.

## 05 — Evidenzpaket **[GEÄNDERT]**

> **Das Ergebnis ist mehr als ein Häkchen**
>
> Jede Freigabe soll später von einer skeptischen dritten Partei verstanden werden können.

1. **Prüfergebnis** — die unabhängig erfassten Urteile und ihre Abweichung.
2. **Kontext** — festgeschriebene Policy, Prüffrage, Optionen und Zeitpunkte.
3. **Nachweis** — **rekonstruierbares, exportierbares Evidenzpaket**.
4. **Entscheidung** — die Go-/Überarbeiten-/Stop-Entscheidung der verantwortlichen Person,
   als **eigener, an das Paket gebundener Datensatz**.

**[GEÄNDERT], zwei Dinge.** „Signiertes, exportierbares Paket" ist ersetzt. Und die
Reihenfolge war sachlich falsch: die Folie stellte die Entscheidung als Inhalt des
signierten Pakets dar. Die Produktdokumentation sagt ausdrücklich das Gegenteil — das Paket
enthält die Eigentümerentscheidung nicht und signiert sie nicht; sie ist ein separater
Datensatz. Wer die alte Folie zeigt und danach die Doku, widerspricht sich.

*Wenn gefragt wird, ob man das prüfen kann:* ja, und zwar sofort — der öffentliche Verifier
unter `/docs/evidence/verify` prüft ein Paket im Browser, ohne Upload und ohne Anmeldung.
Das ist der glaubwürdigste einzelne Beleg, den es heute gibt. Zeigen.

## 06 — Vertrauen beginnt mit Grenzen

> **Was RateLoop heute liefert — und was nicht**

| LIEFERT | LIEFERT NICHT |
| ------- | ------------- |
| Operative Human Assurance | Keine pauschale Garantie |
| Rekonstruierbares Evidenzpaket | Kein AI-Act-Zertifikat |
| Aufgezeichnete Entscheidung mit Begründung und Abweichung | Kein Audit und kein Rechtsgutachten |
| Beratende Integration in den Arbeitsablauf | Keine Sicherheits- oder Fehlerfreiheitszusage |

**Diese Folie nicht kürzen.** Sie ist die stärkste des Decks. In deutschen
Beschaffungsgesprächen kauft die rechte Spalte mehr Vertrauen als die linke.

Ergänzend, wenn nachgefragt wird: kein SOC 2, kein ISO 27001, kein ISO 42001. Aktuelle
Integrationen sind **beratend** — sie dokumentieren den Lebenszyklus, halten aber keine
Ausgabe physisch zurück, und derzeit hat **kein Host** die verifizierte Stufe.

## 07 — Founding Assurance Pilot **[GEÄNDERT]**

> **Der kleinste belastbare Einstieg**
>
> Kein Großprojekt: ein kontrollierter Workflow mit klarer Erfolgsmessung.

**6 Wochen · € 2.500 netto zzgl. 19 % USt. · 50 % anrechenbar** auf einen Jahresvertrag,
der innerhalb von 30 Tagen nach Abschluss des Piloten unterzeichnet wird.

Enthalten: ein produktiver Anwendungsfall; bis zu drei aktive Agents und fünf eingeladene
Review-Gruppen; unbegrenzt eingeladene, unbezahlte Prüfende; Kick-off zu Prüfregel,
Entscheidungsbefugnis, Datenfreigabe, Aufbewahrung und Abbruchbedingungen; vier Wochen
Live-Betrieb; Evidenz-Übergabe; Abschlussreview mit dokumentierter Go-/No-Go-Entscheidung.

Zahlung per Rechnung, SEPA-Überweisung, netto 14 Tage.

**[GEÄNDERT]** Der öffentliche $-29-Anker auf der Preisseite wird gestrichen; bis das
umgesetzt ist, die Preisseite im Termin nicht öffnen. Grenzen der Agent- und Gruppenzahl
sind im Produkt tatsächlich durchgesetzt und dürfen zugesagt werden; die
Entscheidungs-Allowance ist es nicht und wird nicht zugesagt.

*Notiz:* Der Preis liegt zwischen dem deutschen AI-Act-Readiness-Scan (ab € 1.950 netto) und
dem Festpreispaket (€ 4.500 netto) vergleichbarer Anbieter, und eine Größenordnung unter
Implementierungsprojekten ab € 25.000. Er ist marktkonform und eher am unteren Rand.

## 08 — Erfolgsmessung

> **Der Pilot endet mit einer Go/No-Go-Entscheidung**
>
> Vor dem Start werden Zielwerte und Ausgangslage gemeinsam festgehalten.

Sechs Tore: **Abdeckung · Zugriff · Tempo · Qualität · Nachweis · Kauf**.

**[GEÄNDERT] beim Tor „Nachweis":** formuliert als *„Ein benannter Leser kann das Paket mit
dem bereitgestellten Verifier nachvollziehen"* — nicht als „offline prüfen". Der
Browser-Verifier lädt die öffentlichen Schlüssel über das Netz; vollständig offline läuft
nur das Kommandozeilenwerkzeug. Ein Erfolgstor muss die Unterscheidung aushalten.

## 09 — Abschluss

> **RateLoop**
>
> Nennen Sie uns einen Arbeitsablauf, in dem eine KI-Ausgabe heute freigegeben wird.
> Dann prüfen wir gemeinsam, ob RateLoop daraus in sechs Wochen einen belastbaren
> Entscheidungs- und Evidenzpfad macht.
>
> **Pilot-Scoping vereinbaren**

Kontakt: Domain-Postfach und Buchungslink — **nicht** die ProtonMail-Adresse. Beides ist
Tier 0 in der Readiness-Liste und muss vor dem ersten Versand stehen.

---

## Sprechzettel: die drei Fragen, die kommen

**„Macht uns das compliant?"** → „**Nein.** RateLoop stellt keine Konformität her und
beurteilt nicht, welche Anforderungen für Sie gelten. Wir liefern Evidenz für Ihre Akte;
die Bewertung bleibt bei Ihnen."

**„Kein ISO, kein SOC 2?"** → „Korrekt, wir haben keines. Was wir liefern, ist die Evidenz,
mit der Sie Ihre eigene Pflicht erfüllen — Art. 28 Abs. 1 DSGVO, NIS2-Lieferkette, DORA
Art. 28, AI Act Art. 26. Dazu DPA, Subprozessorenliste, Datenorte, Aufbewahrung und den
Incident-Prozess."

**„Wer prüft denn?"** → „Ihre eigenen benannten Fachleute. Kein Netzwerk, kein
Crowdsourcing, keine unabhängige Stichprobe."

**[GEÄNDERT]** Der frühere Nachsatz — „jede einschlägige Regelung verlangt die Aufsicht
durch Personen, die Sie benannt haben" — ist gestrichen. Er ist als pauschale Aussage über
*jede* Regelung nicht haltbar (Art. 20 Abs. 6 DSA etwa verlangt „angemessen qualifiziertes
Personal", nicht vom Kunden benannte Personen) und macht aus einer Produktgrenze eine
behauptete Rechtspflicht. Falls nachgefragt wird, ist die belastbare Fassung: „Die
Regelungen, an denen sich unsere Kunden orientieren, stellen auf Personen ab, die der
Verantwortliche einsetzt. Ob und wie das für Sie gilt, beurteilt Ihre Rechtsabteilung —
wir beraten nicht rechtlich."
