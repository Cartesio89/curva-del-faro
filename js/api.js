// Thin client for the Supabase RPC functions. The publishable key is meant to be public:
// the database only exposes the faro_* functions, never the tables.
export const SUPABASE_URL = "https://prmyrmpmfavppkbzdqyg.supabase.co";
export const SUPABASE_KEY = "sb_publishable_M_ihkB0s9phBxPwDwQFd5g_KDzlQmDW";
const URL = SUPABASE_URL + "/rest/v1/rpc/";
const KEY = SUPABASE_KEY;

async function rpc(name, args) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(URL + name, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: ctrl.signal
    });
    if (!r.ok) return { error: "network", status: r.status };
    return await r.json();
  } catch (e) {
    return { error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  register: (name, pin) => rpc("faro_register", { p_name: name, p_pin: pin }),
  login: (name, pin) => rpc("faro_login", { p_name: name, p_pin: pin }),
  profile: (token) => rpc("faro_profile", { p_token: token }),
  logout: (token) => rpc("faro_logout", { p_token: token }),
  saveGarage: (token, garage) => rpc("faro_save_garage", { p_token: token, p_garage: garage }),
  submitRun: (token, track, car, distance, time, cp, coins, maxKmh) =>
    rpc("faro_submit_run2", { p_token: token, p_track: track, p_car: car, p_distance: distance, p_time: time, p_checkpoints: cp, p_coins: coins, p_max_kmh: maxKmh ?? null }),
  buy: (token, car, item) => rpc("faro_buy", { p_token: token, p_car: car, p_item: item }),
  top: (track) => rpc("faro_top", { p_track: track }),
  submitCircuit: (token, circuit, car, position, time, bestLap, maxKmh) =>
    rpc("faro_submit_circuit2", { p_token: token, p_circuit: circuit, p_car: car, p_position: position, p_time: time, p_best_lap: bestLap, p_max_kmh: maxKmh ?? null }),
  topLaps: (circuit) => rpc("faro_top_laps", { p_circuit: circuit }),
  topEndless: (track) => rpc("faro_board", { p_kind: "endless", p_filter: track || null }),
  topCircuit: (circuit) => rpc("faro_board", { p_kind: "circuit", p_filter: circuit }),
  topRaces: () => rpc("faro_board", { p_kind: "races" }),
  champCurrent: (token) => rpc("faro_champ_current", { p_token: token }),
  champStart: (token, car, field) => rpc("faro_champ_start", { p_token: token, p_car: car, p_field: field }),
  champStage: (token, champ, position, time, bestLap, order, retire, maxKmh) =>
    rpc("faro_champ_stage2", { p_token: token, p_champ: champ, p_position: position, p_time: time, p_best_lap: bestLap, p_order: order, p_retire: !!retire, p_max_kmh: maxKmh ?? null }),
  topChamp: () => rpc("faro_board", { p_kind: "champ" }),
  roomCreate: (token, circuit, car, setup) => rpc("faro_room_create", { p_token: token, p_circuit: circuit, p_car: car, p_setup: setup }),
  roomInvite: (token, room, name) => rpc("faro_room_invite", { p_token: token, p_room: room, p_name: name }),
  invitesPending: (token) => rpc("faro_invites_pending", { p_token: token }),
  roomRespond: (token, room, accept) => rpc("faro_room_respond", { p_token: token, p_room: room, p_accept: accept }),
  roomGet: (token, room) => rpc("faro_room_get", { p_token: token, p_room: room }),
  roomNext: (token, room, circuit) => rpc("faro_room_next", { p_token: token, p_room: room, p_circuit: circuit }),
  roomLeave: (token, room) => rpc("faro_room_leave", { p_token: token, p_room: room }),
  roomStatus: (token, room, status) => rpc("faro_room_status", { p_token: token, p_room: room, p_status: status }),
  challengeResult: (token, room, raceNo, position, realRank, humans, time, best, maxKmh) =>
    rpc("faro_challenge_result2", { p_token: token, p_room: room, p_race_no: raceNo, p_position: position, p_real_rank: realRank, p_humans: humans, p_time: time, p_best_lap: best, p_max_kmh: maxKmh ?? null }),
  topChallenges: () => rpc("faro_board", { p_kind: "challenges" }),
  // every leaderboard: kind (endless, circuit, races, champ, challenges, speed), track/circuit filter, car filter
  board: (kind, filter, car) => rpc("faro_board", { p_kind: kind, p_filter: filter || null, p_car: car || null })
};

export const ERRORS = {
  bad_name: "Nome non valido: 2-14 caratteri, lettere, numeri, spazi, punto o trattino.",
  bad_pin: "Il PIN deve essere di 4 cifre.",
  name_taken: "Questo nome è già usato. Se è tuo, entra con il PIN.",
  bad_login: "Nome o PIN sbagliati.",
  locked: "Troppi tentativi sbagliati: account bloccato per qualche minuto.",
  no_session: "Sessione scaduta: rientra con nome e PIN.",
  network: "Connessione assente o server non raggiungibile.",
  too_fast: "Partita troppo ravvicinata alla precedente: non salvata.",
  implausible: "Risultato non plausibile: non salvato.",
  no_coins: "Monete insufficienti.",
  already_owned: "Ce l'hai già.",
  car_not_owned: "Prima devi comprare l'auto.",
  bad_item: "Oggetto non in vendita.",
  locked_circuit: "Circuito non ancora sbloccato.",
  no_champ: "Campionato non trovato o già concluso.",
  no_room: "La sfida non c'è più.",
  no_player: "Giocatore non trovato.",
  room_full: "La sfida è al completo (6).",
  duplicate: "Risultato già salvato."
};
