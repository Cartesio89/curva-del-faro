// Thin client for the Supabase RPC functions. The publishable key is meant to be public:
// the database only exposes the faro_* functions, never the tables.
const URL = "https://prmyrmpmfavppkbzdqyg.supabase.co/rest/v1/rpc/";
const KEY = "sb_publishable_M_ihkB0s9phBxPwDwQFd5g_KDzlQmDW";

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
  submitRun: (token, track, car, distance, time, cp, coins) =>
    rpc("faro_submit_run", { p_token: token, p_track: track, p_car: car, p_distance: distance, p_time: time, p_checkpoints: cp, p_coins: coins }),
  buy: (token, car, item) => rpc("faro_buy", { p_token: token, p_car: car, p_item: item }),
  top: (track) => rpc("faro_top", { p_track: track })
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
  bad_item: "Oggetto non in vendita."
};
