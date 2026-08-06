# Vertriebsleitfaden Deutschland — Source

Stand 6. August 2026. Source for `rateloop-deutschland-vertriebsleitfaden-2026-08.docx`.
Interner Leitfaden, nicht für Kunden.

Änderungen gegenüber der gebauten Fassung sind mit **[GEÄNDERT]** markiert.

## 1. Positionierung

RateLoop macht aus einem konfigurierten Human-Review-Schritt einen rekonstruierbaren
Entscheidungspfad. Verkauft wird an Unternehmen, die KI produktiv einsetzen und deren
Freigabeentscheidungen heute in Chat, Mail und Tickets verstreut sind.

**30-Sekunden-Pitch [GEÄNDERT]:**

> „Wenn bei Ihnen heute jemand eine KI-Ausgabe freigibt, passiert das meist in einem Chat
> und ist später schwer zu belegen. RateLoop schreibt Prüffrage und Policy vorher fest,
> lässt Ihre benannten Fachleute unabhängig voneinander urteilen und erzeugt daraus einen
> **rekonstruierbaren Entscheidungs- und Evidenzpfad**. Ihr Unternehmen behält die
> Entscheidung und die rechtliche Verantwortung."

*Vorher stand hier „und einem verifizierbaren Nachweispaket". Gestrichen — siehe §8.*

**Der Anker ist ISO/IEC 42001, nicht der AI Act. [GEÄNDERT]** Der AI Act ist der schwächere
Aufhänger: Art. 14 verpflichtet den Anbieter beim Design und enthält keine
Nachweispflicht, und die Hochrisiko-Pflichten wurden auf den 2. Dezember 2027 verschoben.
ISO 42001 gilt heute, hat einen Termin, einen Auditor und ein bestehendes Budget — und die
Frage des Auditors ist nicht „haben Sie eine Aufsichts-Policy", sondern „zeigen Sie mir,
dass die Kontrolle im Zeitraum **gewirkt** hat". Genau das liefern wir.

Nutzbare Zahlen, **vorsichtig verwenden**: ISO-42001-Zertifizierung wird für kleinere
deutsche Unternehmen ab ca. € 8.000 genannt, veröffentlichte Spannen liegen meist zwischen
€ 5.000 und € 50.000, Überwachungsaudits im niedrigen vierstelligen Bereich. **Die
Zertifizierungsstellen veröffentlichen keine Preise**, alle kursierenden Zahlen stammen von
Beratungen. Nicht als Fakt zitieren — der Punkt ist nicht die Zahl, sondern dass die
Budgetlinie bereits existiert. RateLoop hängt sich daran, statt eine neue zu eröffnen.

## 2. Ideales Kundenprofil

Trefferpunkte (10 von 16 Punkten qualifizieren):

- KI produktiv im Einsatz, nicht im Pilotstadium
- ein benennbarer Arbeitsablauf, in dem heute ein Mensch freigibt
- ISO 42001 angestrebt, laufend oder Überwachungsaudit terminiert
- eine verantwortliche Person mit Budget — Datenschutz, Recht, Compliance oder Qualität
- interne Fachleute, die prüfen können und dürfen
- Datenfreigabe rechtlich möglich (kein Berufsgeheimnis, keine Sperre)

**Zwei Adressaten, nicht einer. [GEÄNDERT]** In der Praxis liegt die Budgetverantwortung
für KI-Governance zu rund 44 % bei Datenschutz und Recht und nur zu 17 % bei der IT. Der
Entwickler installiert es, Recht oder Datenschutz bezahlt es. Ein Pitch, der nur bei einem
von beiden landet, bleibt stecken.

**Disqualifizieren bei:** zwingend gefordertem ISO-/SOC-/Residency-Zertifikat, das RateLoop
nicht hat; Erwartung eines externen Prüfernetzwerks; Erwartung, dass Ausgaben physisch
blockiert werden; keine freigebbaren Daten.

## 3. Kanaldisziplin

Kein Cold-Mail-Sequencing, keine LinkedIn-Massen-DMs. § 7 UWG. Zulässig und wirksam:
persönlich vermittelte Einführungen, Fachveranstaltungen, eingehende Anfragen.

Realistische Erwartung: deutsche B2B-Zyklen laufen 2–6 Monate über mehrere
Entscheidungsträger, plus Betriebsrat und AVV-Verhandlung.

## 4. Gesprächsleitfaden

1. **Anlass** — „Wo setzen Sie KI produktiv ein, und wer gibt die Ausgabe heute frei?"
2. **Schmerz** — „Wenn in sechs Monaten jemand fragt, warum diese Ausgabe rausging: was
   könnten Sie zeigen?"
3. **Auslöser** — „Steht ein Audit an? ISO 42001, ISO 27001, Kundenaudit?"
4. **Machbarkeit** — „Dürften zwei Ihrer Fachleute diese Inhalte sehen?"
5. **Entscheidung** — „Wer entscheidet über ein Pilotbudget von € 2.500?"

## 5. Demo

**Vor dem Termin prüfen:** Link zeigt auf `/` oder `/agents`, **nicht** auf `/rate` — das
landet in der leeren Prüfer-Warteschlange. Preisseite im Termin **nicht** öffnen, solange
dort $29 gegen durchgestrichene $99 steht.

**Ablaufreihenfolge:**

1. Konfiguration zeigen: Policy, Prüffrage, Begründungspflicht, Panel, Frist.
2. Eine Prüfung anstoßen und beide Urteile eingehen lassen.
3. Ergebnis mit Begründungen und Abweichung zeigen.
4. **Den öffentlichen Verifier zeigen** — `/docs/evidence/verify`, öffentlich, ohne
   Anmeldung, ohne Upload. **[GEÄNDERT]** Das ist der glaubwürdigste einzelne Beleg, der
   heute existiert, und er war in der gebauten Fassung nicht erwähnt.

**Risiken im Live-Termin, ehrlich einplanen:** Bei Panelgröße 2 erzeugen zwei
widersprechende Urteile das Ergebnis **„inconclusive"** — und das ist der interessanteste
Fall zum Zeigen. Solange das nicht geändert ist: vorbereiten oder nicht live prüfen. Nach
der letzten Antwort kann die Evidenzansicht bis zu fünf Minuten leer bleiben, weil die
Projektion über einen Cron läuft. Nicht im Termin entdecken.

**Nicht zu Chain-Fragen einladen.** Die Verträge liegen auf Base Sepolia mit einem
Mock-Token.

## 6. Pilotangebot

**€ 2.500 netto zzgl. 19 % USt., 6 Wochen, 50 % anrechenbar** auf einen Jahresvertrag
innerhalb von 30 Tagen. Rechnung, SEPA, netto 14 Tage.

Komplex oder reguliert, mit Sicherheitsprüfung oder Integrationsaufwand: **ab € 7.500
netto**.

**[GEÄNDERT]** Der frühere Verweis auf ein € 249-Abo als Anschluss entfällt. Anschluss ist
**€ 1.200/Monat bei Jahresvorauszahlung**, und dieser Preis wird **erst veröffentlicht,
wenn drei Piloten abgeschlossen sind**. Begründung im
[Business Plan](../business-plan.md): bei € 249 liegt der Break-even bei 24–30 Kunden, und
ein Sechs-Wochen-Pilot zu € 2.500 impliziert € 1.667 monatlichen Wert — beides zusammen
ist nicht stimmig.

## 7. Erfolgstore des Piloten

**Abdeckung · Zugriff · Tempo · Qualität · Nachweis · Kauf.**

**[GEÄNDERT] beim Tor „Nachweis":** vorher „Ein benannter externer oder interner Leser kann
das Paket **offline prüfen**". Als **vertragliches** Erfolgstor ist das nicht haltbar,
solange die Fähigkeit als öffentliche Aussage gesperrt ist. Neue Formulierung:

> Ein benannter Leser kann das Evidenzpaket mit dem bereitgestellten Verifier
> nachvollziehen und erklären, was es zeigt und was nicht.

Der Browser-Verifier lädt öffentliche Schlüssel über das Netz; vollständig offline läuft
nur das Kommandozeilenwerkzeug. Ein Erfolgstor muss diese Unterscheidung aushalten.

## 8. Aussagegrenzen — die wichtigste Tabelle im Dokument

**[GEÄNDERT] — eine Zeile ist von „belastbar" nach „nur mit Einordnung" gewandert.**

### Belastbar

| Aussage |
| ------- |
| Policy und Prüffrage werden vor der Zuweisung festgeschrieben |
| Kundeneingeladene, benannte Prüfende urteilen unabhängig voneinander |
| Zeichnet Go/Überarbeiten/Stop, Gründe und Abweichungen auf |
| Prüferidentitäten und Rohbegründungen sind vom Export ausgeschlossen, kleine Zellen unterdrückt |
| Private Inhalte sind in der Applikationsverwahrung verschlüsselt |
| Beratende Integrationen dokumentieren Lifecycle-Status |
| Kann Evidenz für ausgewählte Kontrollprozesse unterstützen |

### Nur mit Einordnung

| Aussage | Einordnung, die mitgesagt werden muss |
| ------- | ------------------------------------- |
| **[GEÄNDERT] Signierte, integritätsprüfbare Nachweispakete** | „Der Export trägt eine Ed25519-Signatur und eine Key-ID, die öffentlichen Schlüssel sind abrufbar, Verifier und Beispielpaket liegen bei. Wir vermarkten das noch nicht als verifizierte Fähigkeit, weil der Signaturpfad extern noch nicht erprobt ist." |
| Nachvollziehbarkeit des Pakets | „Es liegt ein Verifier bei — im Browser und als Kommandozeilenwerkzeug. **Offline-Prüfbarkeit sagen wir nicht zu**, solange die Fähigkeit als öffentliche Aussage gesperrt ist." Der Browser-Verifier lädt die öffentlichen Schlüssel ohnehin über das Netz |
| Verschlüsselte Inhalte | „Autorisierte RateLoop-Workloads können entschlüsseln. Es gibt keine kundengehaltenen Schlüssel." |
| Pilotpreis | „Kommerzielles Angebot, kein veröffentlichter Listenpreis" |
| Base-Sepolia-Deployment | Testnetz, Mock-Token, kein Deployment mit realem Wert |

### Vermeiden

„Manipulationssicher" · „Unabhängige oder repräsentative Prüfende" · „Anonyme Prüfende" ·
**[GEÄNDERT] „Pseudonyme pro Run"** — Identitäten sind ausgeschlossen und pseudonymisiert,
eine Rotation **pro Run** ist nicht bestätigt und wird nicht zugesagt · „Erfüllt allein
Art. 14, 20, 26 oder ISO 42001" · „Customer-held keys" oder „kein Betreiberzugriff" ·
„Ausgabe wird garantiert blockiert" · „Compliance-ready" · jede Zertifizierungsaussage.

## 9. Einwände

**„Macht uns das compliant?"** → „**Nein.**" Diese Antwort nicht abschwächen. Sie ist der
Grund, warum das Gespräch weitergeht.

**„Kein ISO/SOC?"** → „Korrekt. Der Nachweis, den Sie brauchen, ist Ihrer — Art. 28 Abs. 1
DSGVO, NIS2-Lieferkette, DORA Art. 28, AI Act Art. 26. Wir liefern die Evidenz dafür." Dazu:
Pentest-Bericht und ISO-27001-Fahrplan mit Datum, sobald vorhanden.

**„Warum nicht eine Tabelle?"** → Die ehrlichste Frage im Buch, weil die Prüfenden intern
und unbezahlt sind. **[GEÄNDERT]** Antwort nur auf dem, was eine Tabelle strukturell nicht
kann **und was heute belastbar ist**: die Prüffrage steht vor den Antworten fest und ist
nachträglich nicht veränderbar, und die Urteile entstehen unabhängig — in einer Tabelle
sieht jeder, was die anderen eingetragen haben.

*Nicht* mit der Stichprobenmethodik oder mit „ein Nachweis, der ohne uns prüfbar ist"
antworten. Beides ist als öffentliche Aussage gesperrt: die Abdeckungsfelder im Paket
hängen an einem abgeschalteten Capability-Flag, und für die Signatur gilt die
Mechanik-Formulierung aus §8.

Wenn der Pitch „wir protokollieren, wer was geprüft hat" lautet, gewinnt die Tabelle.

**„Was sagt der Betriebsrat?"** → Sehr ernst nehmen. Ein System, das festhält, welcher
benannte Mensch welche KI-Ausgabe wann geprüft hat, ist § 87 Abs. 1 Nr. 6 BetrVG — objektiv
zur Verhaltens- und Leistungskontrolle geeignet, Absicht unerheblich, und eine Einführung
ohne Betriebsvereinbarung ist **rechtlich unwirksam**. AI Act Art. 26 Abs. 7 verlangt
zusätzlich die Information der Arbeitnehmervertretung. Vorbereitete Antwort: keine
Durchsatz- oder Trefferquoten je Prüfer, aggregierte Sichten, und ein
Betriebsvereinbarungs-Muster als Vertriebsmittel.

## 10. Proof Pack

Vor dem ersten Termin bereitlegen: DPA, Subprozessorenliste **mit Sitz, Verarbeitungsland
und Übermittlungsmechanismus**, Datenorte, Rollen, Aufbewahrung und Löschung,
Incident-Prozess, Export und Offboarding, Liste der Aussagegrenzen, synthetisches
Evidenzpaket mit Verifier, und das **Pilot-Auftragsformular**.

**Noch nicht vorhanden und vor Outreach zu erstellen:** Auftragsformular, unterschreibbare
deutsche AVV als PDF, versionierter TOM-Anhang, Security-Whitepaper mit benannter
Hosting-Region, Pentest-Bericht. Siehe
[german-outreach-readiness-2026-08.md](../german-outreach-readiness-2026-08.md), Tier 4.

## 11. Stop-Regel

Abbrechen, wenn: keine freigebbaren Daten; kein benennbarer Freigabeschritt; ein Zertifikat
zwingend gefordert wird, das wir nicht haben; der Betriebsrat ohne Vereinbarung blockiert;
oder wenn nach zwei Gesprächen niemand benannt ist, der über € 2.500 entscheidet.

**Und der Test, der wichtiger ist als jeder Einwand:** Wenn das Gegenüber in den ersten
Gesprächen von „ein Kollege schaut drüber, dreißig Fälle, eine Tabelle" spricht, dann sind
Übereinstimmungsmaße und verblindete Panels für ihn akademischer Überbau. Das ist kein
Einwand, den man ausräumt — das ist der falsche Kunde. Früh testen, es ist billig.
