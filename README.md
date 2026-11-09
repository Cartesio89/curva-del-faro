# Curva del Faro

Gioco di guida 3D infinito nel browser (Three.js, nessun build step).

- Gioca: https://cartesio89.github.io/curva-del-faro/
- Account: nome + PIN di 4 cifre; progressi, garage e record sono sul server, quindi si ritrovano su qualsiasi dispositivo.
- 10 auto con prestazioni diverse; pezzi (rapporti, gomme, alettone, carrozzeria, cerchi, colore) che cambiano forma e statistiche.
- 5 piste (Costiera, Colline, Montagna, Canyon, Città di notte) con aspetto e aderenza diversi.
- Sblocchi: auto con km totali oppure traguardi in una singola partita; piste con i traguardi sulla pista precedente.
- Classifica top 10 per pista (miglior risultato di ogni pilota).
- Gare in pista: 5 circuiti chiusi (`CIRCUITS` in `js/data.js`, logica in `js/circuit.js`) contro 5 piloti IA tarati sull'auto del giocatore; premi in monete per piazzamento; il circuito successivo si sblocca arrivando tra i primi 3; classifica del giro più veloce (`faro_submit_circuit`, `faro_top_laps`).
- Monete M: si raccolgono in gara e si guadagnano a fine partita (1 M ogni 10 m + 5 M a moneta). Auto e pezzi si sbloccano come sopra, poi si comprano; prezzi e saldo sono calcolati dal server (`faro__catalog`, `faro__price`, `faro_buy`) e devono restare allineati a `js/data.js`.

Struttura: `js/data.js` (regole e numeri), `js/world.js` (strada e paesaggio), `js/carmodel.js` (auto 3D), `js/race.js` (fisica e partita),
`js/showroom.js` (garage), `js/main.js` (schermate), `js/api.js` (server). Three.js r170 è in `vendor/` (licenza MIT).

Backend: progetto Supabase "calcetto", tabelle `faro_players`, `faro_sessions`, `faro_runs`, accessibili solo tramite le funzioni `faro_*`.
