# Fortsetzungsprompt für Kimi

Arbeite am vorhandenen Repository Lutho8/warren-will-music und am vorbereiteten Branch `feature/mobile-artist-workspace`. Baue keine zweite App und ersetze die statische Website nicht durch ein neues Framework. Lies zuerst `docs/mobile-app-release.md` und die lokale Vorschau `docs/mobile-app-preview.html`.

Die mobile Oberfläche, ein neuer Supabase-Endpunkt und eine additive Migration wurden lokal vorbereitet. Die Produktionsmigration wurde durch automatische Freigabeprüfung abgelehnt. Weder Migration noch neue App sind veröffentlicht. Diese Sperre nicht umgehen: erst eine konkrete Freigabe für die in der Release-Vorlage genannten Tabellen, Funktionen, Berechtigungen und öffentlichen Terminfreigaben einholen bzw. eine bereits vorliegende dokumentierte Freigabe beachten.

Arbeite danach in dieser Reihenfolge:

1. Lokalen Branch und aktuellen origin/main vergleichen; die bereits veröffentlichten Equipmentpreise und das PDF bewahren.
2. `supabase/migrations/20260911064333_mobile_artist_workflows.sql` in einer getrennten Testdatenbank mit den vorhandenen Alt-Tabellen, Typen und Triggern prüfen. Die bisher 18 Tests unter `tests/artist-workspace.test.mjs` sind API-/UI-Prüfungen mit Testdoubles und beweisen keine SQL-Sperren oder echte iPhone-Funktion.
3. Bestandsreservierung gleichzeitig testen, CSV zweimal importieren, Versionsfreigaben konkurrierend ändern, öffentliche Felder prüfen und doppelten Rechnungsversand simulieren. Keine echten Kunden-E-Mails versenden.
4. Vor Austausch bestehender Funktionen sicherstellen, dass ADMIN_DASH_KEY und CLIENT_DASH_KEY tatsächlich als Secrets gesetzt sind. Niemals Fallback-Passwörter in Quelltext einführen oder den Besitzer ohne bestätigten Ersatzzugang aussperren.
5. Persönliche Konten nur für verifizierte Personen einrichten. Rollen ausschließlich aus serverseitigem app_metadata: crm_enabled true und crm_role artist/management/social. Das Social-Team darf keine Kontakte, Rechnungen, Buchungen oder Bankdaten lesen.
6. Den neuen Endpunkt `artist-workspace` mit der dokumentierten eigenen Authentifizierung deployen und danach bestehende Funktionen sowie statische Dateien abgestimmt veröffentlichen. GitHub-Anmeldung erfolgt nach Benutzerwunsch über den Browser; keine MFA-Einstellungen ändern.
7. Die fünf Bereiche und Formulare im Browser und auf dem iPhone prüfen. Keine Demo-Daten in Produktion übernehmen. Die öffentliche Website muss ausschließlich bestätigte und explizit freigegebene CRM-Termine ausgeben.
8. Plattform-Verbindungen erst mit dem tatsächlich gewählten Tool und erteilten OAuth-/API-Berechtigungen einrichten. Buffer ist die empfohlene einfache Startlösung. Niemals Spotify-Web-API-Daten als vollständige Spotify-for-Artists-Statistik ausgeben. Ohne Anbindung Quellen/Zeiträume manuell erfassen und den Status ehrlich darstellen.
9. Unterschiede zwischen lokal implementiert, geprüft, deployt und tatsächlich extern verbunden klar berichten. Für nicht abgeschlossene Integrationen konkrete nächste Schritte nennen.

Abnahme aus Warrens Sicht: Kontakt finden und Nachfassen setzen, Buchung bearbeiten, Rechnung prüfen, Videoversion freigeben und nachvollziehen, auf welcher Plattform sie veröffentlicht wurde. Effektive Bedienung ist wichtiger als weitere Menüpunkte.
