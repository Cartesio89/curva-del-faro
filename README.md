# Curva del Faro

Gioco di guida 3D infinito nel browser (Three.js, nessun build step).

- Gioca: https://cartesio89.github.io/curva-del-faro/
- Account: nome + PIN di 4 cifre; progressi, garage e record sono sul server, quindi si ritrovano su qualsiasi dispositivo.
- 10 auto con prestazioni diverse; pezzi (rapporti, gomme, alettone, carrozzeria, cerchi, colore) che cambiano forma e statistiche.
- 5 piste (Costiera, Colline, Montagna, Canyon, Città di notte) con aspetto e aderenza diversi.
- Sblocchi: auto con km totali oppure traguardi in una singola partita; piste con i traguardi sulla pista precedente.
- Classifica top 10 per pista (miglior risultato di ogni pilota).

Struttura: `js/data.js` (regole e numeri), `js/world.js` (strada e paesaggio), `js/carmodel.js` (auto 3D), `js/race.js` (fisica e partita),
`js/showroom.js` (garage), `js/main.js` (schermate), `js/api.js` (server). Three.js r170 è in `vendor/` (licenza MIT).

Backend: progetto Supabase "calcetto", tabelle `faro_players`, `faro_sessions`, `faro_runs`, accessibili solo tramite le funzioni `faro_*`.
