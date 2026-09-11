# Warren Will Künstler-App — Freigabevorlage

Stand: 11. September 2026. Umsetzung liegt lokal vor. Diese Version ist **nicht produktiv veröffentlicht**.

Die automatische Freigabeprüfung hat die umfassende Produktionsmigration abgelehnt. Genannter Grund: neue Tabellen und privilegierte Funktionen, Änderungen der öffentlichen Terminfreigabe sowie Zugriffsrechte seien in dieser Breite nicht eng genug autorisiert. Es wurde kein Umgehungsversuch unternommen. Die vorbereitete Migration wurde nicht auf Produktion angewendet.

## Zur Prüfung

`docs/mobile-app-preview.html` ist eine selbstständige, klickbare Vorschau mit ausdrücklich fiktiven Kontakten und Veranstaltungen. Sie sendet keine Netzwerkaufrufe, speichert keine CRM-Daten und verschickt nichts. Die Rollenansichten lassen sich umschalten.

## Implementierter Umfang im Arbeitsstand

- Fünf mobile Bereiche: Heute, Kontakte, Buchungen, Inhalte, Ergebnisse.
- Höchstens drei persönliche Aktionen auf Heute; Team-Aufgaben separat.
- Kontaktsuche, gespeicherte Filter, Gesprächsnotizen, Wiedervorlage, Zuständigkeit und Tags.
- PhantomBuster-CSV: Spaltenzuordnung, Vorschau, 50er-Chargen, Wiederaufnahme durch erneutes Ausführen; vorhandene E-Mail/Telefon-Identitäten werden unverändert übersprungen. Kein automatischer Nachrichtenversand.
- Bearbeitbare Auftritte; Status und ausdrückliche Website-Freigabe.
- Öffentlicher Feed nur mit ID, Datum, Spielzeit, Venue und Stadt. Keine Gagen oder Kundendaten. Abgesagte, private oder vergangene Termine fehlen im Feed.
- 15 Mietangebote mit den vorgegebenen Preisen. Stückzahlen bewusst ungeprüft. Reservierungen benötigen bestätigte Mengen; SQL-Sperren sollen gleichzeitig konkurrierende Reservierungen verhindern.
- Equipment-Buchungen mit Mietdauer in begonnenen 24-Stunden-Zeiträumen, Übergabe, Zahlung und separater Kaution. Mietrechnungen sind an die Vermietung gekoppelt.
- Rechnungsprüfung, Empfängerkorrektur bei Entwürfen, PDF-Abruf, explizite Versandbestätigung, dauerhafter Versandbeleg mit Einmal-Token. Unklare Versandresultate werden nicht automatisch erneut gesendet.
- Inhaltsversionen, Freigabe ausschließlich durch Warren, manuelle Nachweise und eigene Status je Plattform. Eine Bearbeitung macht die Freigabe für die neue Version ungültig.
- Kennzahlen mit Quelle, Zeitraum und Erfassungsdatum; fehlende Daten werden nicht als null dargestellt.
- Persönliche Supabase-Anmeldung vorbereitet; Rollen aus serverseitig gepflegtem `app_metadata`. Social bekommt keine Kunden-, Buchungs- oder Finanzdaten.
- Session-lokale Formularentwürfe, 44-Pixel-Aktionsflächen, untere Navigation und bestehende PWA-Grundlage. Keine verbindlichen Offline-Aktionen.

## Konkrete Produktionsänderung zur Freigabe

Datei: `supabase/migrations/20260911064333_mobile_artist_workflows.sql` (Filename durch Supabase CLI erzeugt).

1. Zusätzliche Felder an `contacts`, `gigs` und `invoices`; vorhandene Datensätze bleiben erhalten.
2. Zehn neue Tabellen für Bestand/Angebote/Vermietungen, Inhalte/Versionen/Plattform-Nachweise, Kennzahlen, Importprotokolle, Änderungsverlauf und Versandbelege.
3. RLS aktivieren; direkte Zugriffe durch `anon` und `authenticated` auf die neuen Tabellen entfernen. Zugriff ausschließlich über die autorisierende Edge Function mit Service-Rolle.
4. Sieben transaktionale SQL-Funktionen als `SECURITY INVOKER`; Ausführung ausschließlich für `service_role`.
5. Die fünf bereits veröffentlichten September-Auftritte werden initial als öffentlich markiert. Alle anderen und neue Termine sind standardmäßig privat.
6. Edge Function `artist-workspace` bereitstellen, vorhandene `crm-update`-Versandlogik härten, Konfiguration prüfen, anschließend die statischen App-Dateien über das vorhandene GitHub/Vercel-Deployment veröffentlichen.

Die SQL-Datei enthält keine Löschung bestehender Tabellen. Trotzdem braucht diese Änderung eine Datenbanksicherung und eine vollständige Testausführung, bevor sie produktiv angewendet wird. Bei Rollback Frontend und Funktionen auf die vorherige Version zurücksetzen; neue Daten nicht durch DROP-Anweisungen entfernen.

## Voraussetzungen vor Veröffentlichung

- GitHub-Browseranmeldung als Repository-Eigentümer wurde geprüft und ist vorhanden. MFA-Einstellungen werden nicht verändert.
- `ADMIN_DASH_KEY` und `CLIENT_DASH_KEY` müssen als tatsächliche Edge-Secrets gesetzt und geprüft sein. Die vorbereiteten Quelltexte entfernen öffentlich hinterlegte Fallback-Passwörter. Alte Funktionen nicht vorher allein austauschen.
- Keine persönlichen Auth-Benutzer vorhanden. Erst verifizierte Konten einrichten, dann serverseitig `crm_enabled: true` und `crm_role: artist | management | social` in `app_metadata` setzen. Niemals `user_metadata` zur Autorisierung verwenden. Bei Entzug zuerst `crm_enabled` entfernen, dann Sitzungen widerrufen.
- Bestandsmengen müssen vor Reservierungen vom Management bestätigt werden.
- Rechnungseinstellungen und vorhandene Resend-Konfiguration prüfen. Ohne eingerichteten Versand keine Behauptung, dass E-Mails versendet wurden. Für Mietrechnungen wird die zur Preisliste passende bestehende Kleinunternehmer-Einstellung verlangt.
- Social-Publisher, YouTube Analytics und Musikplattformen sind **noch nicht verbunden**. Aktuell sind nachvollziehbare manuelle Veröffentlichungsnachweise und Kennzahlen vorgesehen. APIs/OAuth, Importformate, private Asset-Uploads, automatische Hintergrund-Synchronisation und Push-Mitteilungen gehören zur anschließenden Kontoeinrichtung bzw. Integration und werden nicht als fertig ausgewiesen.

## Bisher geprüft

- JavaScript- und TypeScript-Syntaxprüfungen.
- 18 ausführbare Prüfungen für API-Zugriff, Rollentrennung, öffentlichen Feldumfang, Plattformlinks, Pflichtfelder, Schutz vor wiederholtem Versand und CSV-Parsing. Aufruf: `node --test tests/artist-workspace.test.mjs`.
- Diese Prüfungen verwenden ein kontrolliertes Datenbank-Double und versenden keine echten E-Mails.

Noch offen: PostgreSQL-Ausführung und Sperrverhalten, Browserprüfung der integrierten Produktions-App, echtes iPhone-Verhalten sowie vollständige Ende-zu-Ende-Prüfung. Die interne Vorschauinfrastruktur unterstützt dieses bestehende statische Projekt nicht. Ein physisches iPhone wurde nicht getestet.

## Abnahme nach Freigabe

1. Migration in einer getrennten Testdatenbank anwenden. Alle Alt-Tabellen mit vorhandenen Typen/Triggern aus einer bereinigten Sicherung berücksichtigen.
2. Zwei überlappende Reservierungen gleichzeitig versuchen: nur eine darf den letzten Bestand erhalten; angrenzende Zeiten dürfen funktionieren. Keine echte Kundenreservierung zum Testen verwenden.
3. Dieselbe CSV zweimal importieren: zweite Ausführung erzeugt keine weiteren Kontakte und erhält Opt-outs.
4. Inhalt Version 1 freigeben, Version 2 anlegen: keine automatische Freigabe oder Veröffentlichung von Version 2.
5. Einen abgesagten oder privaten Testtermin im öffentlichen Feed ausschließen; keine internen Felder in der Antwort.
6. Versandsimulation doppelt starten: maximal ein Dispatch. Bei unklarem Provider-Ergebnis blockieren und manuell abgleichen. Echte Test-E-Mails nur an einen ausdrücklich freigegebenen Empfänger.
7. Rollen: Social darf keine Kontakt-, Gig-, Rechnungs- oder Lageraktionen ausführen. Warren darf keine Management-Importe oder Rechnungsversände ausführen.
8. Warren prüft auf dem iPhone: Kontakt finden, Wiedervorlage setzen, Buchung ändern, Rechnung öffnen, Plattform-Nachweise verstehen.
9. Produktionsbackup, freigegebene Migration anwenden, Funktionen zuerst prüfen, danach Frontend veröffentlichen; funktionierende alte Anmeldung bis zur bestätigten Umstellung erhalten.
