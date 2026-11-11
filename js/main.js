import * as THREE from "three";
import {
  CARS, TRACKS, PARTS, PART_ORDER, COLORS, carById, trackById, cleanConfig, performance as perfOf,
  carUnlocked, trackUnlocked, unlockText, priceOf, ownsCar, ownsPart, coinsEarned,
  CIRCUITS, circuitById, circuitUnlocked, prizeFor, AI_NAMES
} from "./data.js";
import { api, ERRORS } from "./api.js";
import { Race } from "./race.js";
import { CircuitRace, fmtLap } from "./circuit.js";
import { Showroom } from "./showroom.js";

const $ = (id) => document.getElementById(id);
const STEP = 1 / 60;
const mobile = matchMedia("(pointer: coarse)").matches;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const fmtKm = (m) => ((m || 0) / 1000).toFixed((m || 0) < 10000 ? 1 : 0).replace(".", ",") + " km";
const fmtM = (m) => (m || 0).toLocaleString("it-IT") + " m";
const fmtC = (c) => (c || 0).toLocaleString("it-IT") + " M";

// ------------------------------------------------------------------ renderer
const canvas = $("view"), stage = $("stage");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch (e) {
  $("loading").textContent = "Questo dispositivo non supporta la grafica 3D (WebGL).";
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const showroom = new Showroom(renderer, canvas);

let W = 1, H = 1;
function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.setSize(W, H, false);
  showroom.setAspect(W, H);
  if (race) race.setAspect(W, H);
}
new ResizeObserver(resize).observe(stage);

// ------------------------------------------------------------------ state
let token = store.get("faro-token");
let profile = null;
let garage = { sel: "lucciola", track: "costiera", cars: {} };
let mode = "menu";                 // menu | race | paused | over
let race = null;
let garageIdx = 0;
const input = { gas: false, brake: false, left: false, right: false, tilt: null };

// saved configuration, restricted to what the player owns
function cfgFor(car) {
  const cfg = cleanConfig(car, garage.cars[car.id]);
  const def = cleanConfig(car, null);
  for (const k of [...PART_ORDER, "color"]) if (!ownsPart(profile, car, k, cfg[k])) cfg[k] = def[k];
  return cfg;
}
let preview = null; // {car, key, value} — an option shown in the garage before buying it
const selCar = () => { const c = carById(garage.sel); return carUnlocked(c, profile) && ownsCar(profile, c) ? c : CARS[0]; };
const selTrack = () => { const t = trackById(garage.track); return trackUnlocked(t, profile) ? t : TRACKS[0]; };
const SCREENS = ["scrLogin", "scrHome", "scrGarage", "scrTracks", "scrCircuits", "scrBoard", "scrPause", "scrOver"];
function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  document.body.classList.toggle("racing", !id || id === "scrPause");
}

function setProfile(p, keepGarage) {
  profile = p;
  if (!keepGarage) {
    const g = p.garage || {};
    garage = {
      sel: typeof g.sel === "string" ? g.sel : "lucciola",
      track: typeof g.track === "string" ? g.track : "costiera",
      cars: g.cars && typeof g.cars === "object" ? g.cars : {}
    };
  }
  $("who").hidden = false;
  $("whoName").textContent = p.name;
  $("whoKm").textContent = fmtKm(p.total_m);
  $("whoCoins").textContent = fmtC(p.coins);
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (token) api.saveGarage(token, garage); }, 700);
}

// ------------------------------------------------------------------ login
let loginMode = "login";
function showLogin(msg) {
  endRace();
  $("who").hidden = true;
  showroom.setCar(CARS[0], cfgFor(CARS[0]), false);
  show("scrLogin");
  const err = $("lgErr");
  err.hidden = !msg; err.textContent = msg || "";
}
function setLoginMode(m) {
  loginMode = m;
  $("tabLogin").classList.toggle("on", m === "login"); $("tabLogin").setAttribute("aria-selected", m === "login");
  $("tabNew").classList.toggle("on", m === "new"); $("tabNew").setAttribute("aria-selected", m === "new");
  $("lgGo").textContent = m === "login" ? "Entra" : "Crea pilota";
  $("lgNote").textContent = m === "login"
    ? "Nome e PIN ti fanno ritrovare auto, pezzi e record su qualsiasi telefono o computer."
    : "Scegli un nome (sarà visibile in classifica) e un PIN di 4 cifre da ricordare.";
  $("lgErr").hidden = true;
}
$("tabLogin").addEventListener("click", () => setLoginMode("login"));
$("tabNew").addEventListener("click", () => setLoginMode("new"));
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("lgName").value.trim().replace(/\s+/g, " ");
  const pin = $("lgPin").value.trim();
  const err = $("lgErr");
  if (name.length < 2) { err.textContent = "Scrivi il nome pilota (almeno 2 caratteri)."; err.hidden = false; return; }
  if (!/^[0-9]{4}$/.test(pin)) { err.textContent = ERRORS.bad_pin; err.hidden = false; return; }
  $("lgGo").disabled = true;
  const r = loginMode === "login" ? await api.login(name, pin) : await api.register(name, pin);
  $("lgGo").disabled = false;
  if (r.token) {
    token = r.token; store.set("faro-token", token);
    $("lgPin").value = "";
    setProfile(r.profile);
    goHome();
    return;
  }
  let msg = ERRORS[r.error] || "Qualcosa non ha funzionato. Riprova.";
  if (r.error === "bad_login" && Number.isFinite(r.left)) msg += ` Tentativi rimasti: ${r.left}.`;
  if (r.error === "locked" && r.seconds) msg = `Troppi tentativi sbagliati: riprova tra ${Math.ceil(r.seconds / 60)} minuti.`;
  err.textContent = msg; err.hidden = false;
});

// ------------------------------------------------------------------ home
function goHome() {
  endRace();
  mode = "menu";
  const car = selCar(), track = selTrack();
  showroom.setCar(car, cfgFor(car), false);
  $("homeTitle").textContent = `Box di ${profile.name}`;
  $("homeCar").textContent = car.name;
  $("homeTrack").textContent = track.name;
  const b = profile.best && profile.best[track.id];
  $("homeBest").textContent = b ? fmtM(b.best_m) : "—";
  const buyable = CARS.filter((c) => carUnlocked(c, profile) && !ownsCar(profile, c));
  const nextCar = CARS.find((c) => !carUnlocked(c, profile));
  const nextTrack = TRACKS.find((t) => !trackUnlocked(t, profile));
  const bits = [];
  if (buyable.length) bits.push(`Sbloccata da comprare: ${buyable[0].name}, ${fmtC(priceOf(buyable[0], "car"))}.`);
  if (nextCar) bits.push(`Prossima auto, ${nextCar.name}: ${unlockText(nextCar)}.`);
  if (nextTrack) bits.push(`Prossima pista, ${nextTrack.name}: ${unlockText(nextTrack)}.`);
  $("homeNext").textContent = bits.join(" ");
  show("scrHome");
}
$("goRace").addEventListener("click", () => startRace());
$("goGarage").addEventListener("click", () => openGarage());
$("goTracks").addEventListener("click", () => openTracks());
$("homeTrackBtn").addEventListener("click", () => openTracks());
$("goCircuits").addEventListener("click", () => openCircuits());
$("goBoard").addEventListener("click", () => openBoard("endless"));
$("goLogout").addEventListener("click", async () => {
  if (token) api.logout(token);
  token = null; store.del("faro-token"); profile = null;
  setLoginMode("login"); showLogin();
});

// ------------------------------------------------------------------ garage
function openGarage() {
  garageIdx = Math.max(0, CARS.findIndex((c) => c.id === selCar().id));
  renderGarage(true);
  show("scrGarage");
}
// value bar with a tick at the reference value and the difference in numbers
function statBar(label, frac, refFrac, text, delta, good, refLabel) {
  const row = document.createElement("div"); row.className = "bar";
  const a = document.createElement("span"); a.textContent = label;
  const t = document.createElement("span"); t.className = "track-bar";
  const clampF = (f) => Math.max(0.04, Math.min(1, f));
  const f = document.createElement("span"); f.className = "fill"; f.style.width = Math.round(clampF(frac) * 100) + "%"; f.style.display = "block";
  t.appendChild(f);
  if (refFrac != null) { const tick = document.createElement("i"); tick.className = "tick"; tick.style.left = Math.round(clampF(refFrac) * 100) + "%"; t.appendChild(tick); }
  const b = document.createElement("b"); b.textContent = text;
  if (delta) { const d = document.createElement("small"); d.className = good ? "up" : "down"; d.textContent = delta; b.appendChild(d); }
  row.append(a, t, b);
  return row;
}
const pct = (x) => (x > 1 ? "+" : "−") + Math.round(Math.abs(x - 1) * 100) + "%";
function effectText(key, value) {
  if (key === "color") return "solo estetica";
  const o = PARTS[key].options.find((x) => x.id === value);
  const bits = [];
  if (o.top && o.top !== 1) bits.push(`velocità max ${pct(o.top)}`);
  if (o.acc && o.acc !== 1) bits.push(`accelerazione ${pct(o.acc)}`);
  if (o.grip && o.grip !== 1) bits.push(`tenuta ${pct(o.grip)}`);
  return bits.length ? bits.join(", ") : "solo estetica";
}
function perfBars(car, cfg, refCfg, refLabel) {
  const p = perfOf(car, cfg), r = perfOf(car, refCfg);
  const fTop = (v) => (v - 150) / 260, fAcc = (v) => (13 - v) / 11, fGrip = (v) => (v - 8) / 14;
  const dTop = Math.round(p.topKmh - r.topKmh), dAcc = p.acc0100 - r.acc0100, dGrip = (p.grip - r.grip) / 9.81;
  const num = (x, dec) => x.toFixed(dec).replace(".", ",");
  const cap = document.createElement("p"); cap.className = "cmp";
  cap.textContent = `Differenze rispetto alla versione ${refLabel}. La tacca bianca è il valore ${refLabel}.`;
  return [cap,
    statBar("Velocità", fTop(p.topKmh), fTop(r.topKmh), Math.round(p.topKmh) + " km/h", dTop ? (dTop > 0 ? "+" : "−") + Math.abs(dTop) + " km/h" : "", dTop > 0, refLabel),
    statBar("0-100", fAcc(p.acc0100), fAcc(r.acc0100), num(p.acc0100, 1) + " s", Math.abs(dAcc) >= 0.05 ? (dAcc > 0 ? "+" : "−") + num(Math.abs(dAcc), 1) + " s" : "", dAcc < 0, refLabel),
    statBar("Tenuta", fGrip(p.grip), fGrip(r.grip), num(p.grip / 9.81, 2) + " g", Math.abs(dGrip) >= 0.005 ? (dGrip > 0 ? "+" : "−") + num(Math.abs(dGrip), 2) + " g" : "", dGrip > 0, refLabel)
  ];
}
let gAction = null;
function renderGarage(rebuildModel) {
  const car = CARS[garageIdx];
  const locked = !carUnlocked(car, profile);
  const owned = ownsCar(profile, car);
  if (preview && preview.car !== car.id) preview = null;
  const cfg = cfgFor(car);
  if (preview) cfg[preview.key] = preview.value;
  if (rebuildModel) showroom.setCar(car, cfg, locked);
  $("gName").textContent = car.name;
  $("gKind").textContent = `${garageIdx + 1}/10 · ${car.kind}`;
  const lock = $("gLock");
  lock.hidden = !locked;
  lock.textContent = locked ? `Bloccata: ${unlockText(car)}.` : "";
  const st = $("gStats"); st.textContent = "";
  if (preview) st.append(...perfBars(car, cfg, cfgFor(car), "montata"));
  else st.append(...perfBars(car, cfg, cleanConfig(car, null), "di serie"));
  const parts = $("gParts"); parts.textContent = "";
  const canEdit = !locked && owned;
  const optButton = (key, value, label, isSwatch) => {
    const b = document.createElement("button");
    const have = ownsPart(profile, car, key, value);
    const price = priceOf(car, key, value);
    b.className = (isSwatch ? "sw" : "opt") + (cfg[key] === value ? " on" : "") + (have ? "" : " shop");
    if (isSwatch) { b.style.background = value; b.setAttribute("aria-label", `Colore${have ? "" : ", " + fmtC(price)}`); }
    else {
      b.textContent = label;
      if (!have) { const pr = document.createElement("small"); pr.textContent = fmtC(price); b.appendChild(pr); }
    }
    b.disabled = !canEdit;
    b.addEventListener("click", () => {
      if (have) { preview = null; setPart(car, key, value); }
      else { preview = { car: car.id, key, value, label: isSwatch ? "colore" : `${PARTS[key].label.toLowerCase()} ${label.toLowerCase()}` }; renderGarage(true); }
    });
    return b;
  };
  for (const key of PART_ORDER) {
    const box = document.createElement("div"); box.className = "part";
    const lab = document.createElement("small"); lab.textContent = PARTS[key].label;
    const opts = document.createElement("div"); opts.className = "opts";
    for (const o of PARTS[key].options) opts.appendChild(optButton(key, o.id, o.label, false));
    box.append(lab, opts); parts.appendChild(box);
  }
  const cbox = document.createElement("div"); cbox.className = "part";
  const clab = document.createElement("small"); clab.textContent = "Colore";
  const sws = document.createElement("div"); sws.className = "swatches";
  for (const c of COLORS) sws.appendChild(optButton("color", c, "", true));
  cbox.append(clab, sws); parts.appendChild(cbox);

  const use = $("gUse"), msg = $("gMsg");
  const coins = profile.coins || 0;
  gAction = null; use.disabled = true;
  if (locked) use.textContent = "Bloccata";
  else if (!owned) {
    const price = priceOf(car, "car");
    use.textContent = `Compra l'auto · ${fmtC(price)}`;
    gAction = { item: "car", price }; use.disabled = coins < price;
  } else if (preview) {
    const price = priceOf(car, preview.key, preview.value);
    use.textContent = `Compra ${preview.label} · ${fmtC(price)}`;
    gAction = { item: `${preview.key}:${preview.value}`, price, key: preview.key, value: preview.value }; use.disabled = coins < price;
  } else if (garage.sel === car.id) use.textContent = "In uso";
  else { use.textContent = "Usa questa auto"; use.disabled = false; gAction = { use: true }; }
  if (gAction && gAction.price != null && coins < gAction.price) msg.textContent = (preview ? `${effectText(preview.key, preview.value)}. ` : "") + `Hai ${fmtC(coins)}: ti mancano ${fmtC(gAction.price - coins)}.`;
  else if (preview) msg.textContent = `Anteprima ${preview.label}: ${effectText(preview.key, preview.value)}.`;
  else msg.textContent = "";
  msg.hidden = !msg.textContent;
}
function setPart(car, key, value) {
  const cfg = { ...cfgFor(car), [key]: value };
  garage.cars[car.id] = cfg;
  scheduleSave();
  renderGarage(true);
}
$("carPrev").addEventListener("click", () => { preview = null; garageIdx = (garageIdx + CARS.length - 1) % CARS.length; renderGarage(true); });
$("carNext").addEventListener("click", () => { preview = null; garageIdx = (garageIdx + 1) % CARS.length; renderGarage(true); });
$("gUse").addEventListener("click", async () => {
  const car = CARS[garageIdx];
  if (!gAction) return;
  if (gAction.use) { garage.sel = car.id; scheduleSave(); renderGarage(false); return; }
  const use = $("gUse"); use.disabled = true; use.textContent = "Acquisto…";
  const r = await api.buy(token, car.id, gAction.item);
  if (r && r.profile) {
    setProfile(r.profile, true);
    if (gAction.key) { preview = null; setPart(car, gAction.key, gAction.value); }
    else { garage.sel = car.id; scheduleSave(); renderGarage(true); }
    toastMenu(`Acquistato: −${fmtC(r.price)}`);
  } else {
    renderGarage(false);
    const msg = $("gMsg");
    msg.textContent = r && r.error === "locked" ? "Auto non ancora sbloccata." : (ERRORS[r && r.error] || "Acquisto non riuscito.");
    msg.hidden = false;
  }
});
function toastMenu(text) { toast(text, "good"); }
$("gBack").addEventListener("click", goHome);

// ------------------------------------------------------------------ tracks
function openTracks() {
  const list = $("trackList"); list.textContent = "";
  for (const t of TRACKS) {
    const ok = trackUnlocked(t, profile);
    const b = document.createElement("button");
    b.className = "track" + (selTrack().id === t.id ? " on" : "");
    b.disabled = !ok;
    const sw = document.createElement("span"); sw.className = "sw-big";
    sw.style.background = `linear-gradient(180deg, ${t.sky[0]}, ${t.sky[1]} 55%, ${t.ground} 56%, ${t.road})`;
    const txt = document.createElement("span");
    const name = document.createElement("b"); name.textContent = t.name;
    const d = document.createElement("span");
    const best = profile.best && profile.best[t.id];
    d.textContent = ok ? `${t.desc}${best ? " Record: " + fmtM(best.best_m) + ", " + best.best_cp + " traguardi." : ""}` : `Bloccata: ${unlockText(t)}.`;
    txt.append(name, d);
    b.append(sw, txt);
    b.addEventListener("click", () => { garage.track = t.id; scheduleSave(); goHome(); });
    list.appendChild(b);
  }
  show("scrTracks");
}
$("tBack").addEventListener("click", goHome);

// ------------------------------------------------------------------ leaderboard
// kind: "endless" (top 10 runs), "races" (championship points) or "circuit" (top 10 races on one circuit)
function renderBoard(ol, rows, highlightName, kind) {
  ol.textContent = "";
  const li0 = (text) => { const li = document.createElement("li"); li.className = "empty"; li.textContent = text; ol.appendChild(li); };
  if (!Array.isArray(rows)) return li0("Classifica non raggiungibile in questo momento.");
  if (!rows.length) return li0(kind === "endless" ? "Ancora nessun risultato qui. Il primo posto è libero." : "Ancora nessuna gara conclusa qui. Il primo posto è libero.");
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (highlightName && r.name.toLowerCase() === highlightName.toLowerCase()) li.className = "me";
    const pos = document.createElement("span"); pos.className = "pos"; pos.textContent = i + 1;
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = r.name;
    const sub = document.createElement("small");
    const m = document.createElement("span"); m.className = "m";
    const t = document.createElement("span"); t.className = "t";
    if (kind === "champ") {
      sub.textContent = `${carById(r.car).name} · ${r.wins === 1 ? "1 vittoria" : r.wins + " vittorie"} di tappa`;
      m.textContent = `${r.points} pt`;
      t.textContent = fmtLap(Number(r.total_time));
    } else if (kind === "races") {
      sub.textContent = `${r.circuits}/5 circuiti · ${r.races} gare`;
      m.textContent = `${r.points} pt`;
      t.textContent = r.wins === 1 ? "1 vittoria" : `${r.wins} vittorie`;
    } else if (kind === "circuit") {
      sub.textContent = `${carById(r.car).name} · giro ${fmtLap(Number(r.best_lap))}`;
      m.textContent = `${r.position}° pos.`;
      t.textContent = fmtLap(Number(r.total_time));
    } else {
      sub.textContent = `${trackById(r.track).name} · ${carById(r.car).name}`;
      m.textContent = fmtM(r.distance_m);
      t.textContent = Math.round(r.time_s) + " s";
    }
    nm.appendChild(sub);
    li.append(pos, nm, m, t); ol.appendChild(li);
  });
}
// kind: "endless" | "races"; filter: track id / circuit id, or "" for the overall board
async function openBoard(kind, filter = "") {
  kind = kind === "races" || kind === "champ" ? kind : "endless";
  const tabs = $("boardTabs"); tabs.textContent = "";
  for (const [k, label] of [["endless", "Pista infinita"], ["races", "Gare"], ["champ", "Campionato"]]) {
    const b = document.createElement("button");
    b.className = "tab" + (k === kind ? " on" : ""); b.textContent = label; b.setAttribute("role", "tab");
    b.addEventListener("click", () => openBoard(k));
    tabs.appendChild(b);
  }
  const fl = $("boardFilters"); fl.textContent = "";
  const opts = kind === "champ" ? []
    : kind === "races"
    ? [["", "Generale"], ...CIRCUITS.map((c) => [c.id, c.name])]
    : [["", "Tutte le piste"], ...TRACKS.map((t) => [t.id, t.name])];
  for (const [id, label] of opts) {
    const b = document.createElement("button");
    b.className = "opt" + (id === filter ? " on" : ""); b.textContent = label;
    b.addEventListener("click", () => openBoard(kind, id));
    fl.appendChild(b);
  }
  fl.hidden = kind === "champ";
  $("boardNote").textContent = kind === "champ"
    ? "I 10 migliori campionati conclusi: prima i punti totali delle 5 tappe, poi il tempo totale sommato."
    : kind === "races"
    ? (filter ? "Le 10 migliori gare su questo circuito: prima il piazzamento, poi il tempo totale."
              : "Generale: per ogni circuito conta il miglior arrivo di ciascun pilota (25, 18, 15, 12, 10, 8 punti dal 1° al 6°).")
    : (filter ? "I 10 migliori risultati su questa pista." : "I 10 migliori risultati su tutte le piste.");
  show("scrBoard");
  const ol = $("boardList");
  ol.innerHTML = '<li class="empty">Carico…</li>';
  let rows, k;
  if (kind === "champ") { rows = await api.topChamp(); k = "champ"; }
  else if (kind === "races") { rows = filter ? await api.topCircuit(filter) : await api.topRaces(); k = filter ? "circuit" : "races"; }
  else { rows = await api.topEndless(filter || null); k = "endless"; }
  renderBoard(ol, rows, profile && profile.name, k);
}
$("bBack").addEventListener("click", goHome);

// ------------------------------------------------------------------ circuits
// ------------------------------------------------------------------ championship
// One stage per circuit, in order, against the same 5 rivals. State lives on the server (any device).
const CH_POINTS = [25, 18, 15, 12, 10, 8];
let champ = null;
function champStandings(ch) {
  const tab = new Map();
  const add = (name, isPlayer, pts, time) => {
    const r = tab.get(name) || { name, isPlayer, points: 0, time: 0, wins: 0 };
    r.points += pts; r.time += time || 0; if (pts === 25) r.wins++;
    tab.set(name, r);
  };
  for (const f of ch.field) add(f.n, false, 0, 0);
  add(profile.name, true, 0, 0);
  for (const st of ch.results) (st.order || []).forEach((o, i) => add(o.p ? profile.name : o.n, !!o.p, o.p ? st.points : CH_POINTS[i] || 0, o.p ? st.time : o.t));
  return [...tab.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.time - b.time);
}
function standingsList(ol, rows) {
  ol.textContent = "";
  rows.forEach((r, i) => {
    const li = document.createElement("li"); if (r.isPlayer) li.className = "me";
    const pos = document.createElement("b"); pos.textContent = `${i + 1}.`;
    const nm = document.createElement("span"); nm.className = "on"; nm.textContent = r.name;
    const sm = document.createElement("small"); sm.textContent = r.wins ? ` · ${r.wins === 1 ? "1 vittoria" : r.wins + " vittorie"}` : ""; nm.appendChild(sm);
    const pt = document.createElement("span"); pt.className = "ot"; pt.textContent = `${r.points} pt`;
    li.append(pos, nm, pt); ol.appendChild(li);
  });
}
function renderChampBox() {
  const box = $("champBox"); box.textContent = "";
  const h = document.createElement("h3"); h.textContent = "Campionato";
  const p = document.createElement("p"); p.className = "note";
  box.append(h, p);
  const act = document.createElement("div"); act.className = "actions";
  if (champ && !champ.done) {
    const c = circuitById(champ.next), car = carById(champ.car);
    p.textContent = `Tappa ${champ.stage + 1} di 5: ${c.name}, ${c.laps} giri. Con ${car.name}. Hai ${champ.points} punti, tempo totale ${fmtLap(Number(champ.total_time))}.`;
    const ol = document.createElement("ol"); ol.className = "order"; standingsList(ol, champStandings(champ)); box.appendChild(ol);
    const go = document.createElement("button"); go.className = "go"; go.textContent = `Corri la tappa ${champ.stage + 1}`;
    go.addEventListener("click", () => startChampStage());
    const re = document.createElement("button"); re.className = "ghost"; re.textContent = "Ricomincia";
    re.addEventListener("click", () => newChamp());
    act.append(go, re);
  } else {
    p.textContent = `5 tappe, una per circuito, contro gli stessi 5 piloti. Punti a ogni tappa: ${CH_POINTS.join(", ")}. In classifica contano i punti totali, poi il tempo totale. Corri con l'auto scelta ora: ${selCar().name}.`;
    const go = document.createElement("button"); go.className = "go"; go.textContent = "Nuovo campionato";
    go.addEventListener("click", () => newChamp());
    act.append(go);
  }
  box.appendChild(act);
}
async function loadChamp() {
  const r = await api.champCurrent(token);
  champ = r && r.champ ? r.champ : null;
  if (!$("scrCircuits").hidden) renderChampBox();
  if (r && r.error === "network") $("champBox").querySelector(".note").textContent = ERRORS.network;
}
async function newChamp() {
  const car = selCar();
  const field = AI_NAMES.slice().sort(() => Math.random() - 0.5).slice(0, 5).map((n) => ({ n }));
  $("champBox").querySelector(".note").textContent = "Preparo il campionato…";
  const r = await api.champStart(token, car.id, field);
  if (r && r.champ) { champ = r.champ; startChampStage(); }
  else $("champBox").querySelector(".note").textContent = ERRORS[r && r.error] || "Campionato non avviato.";
}
function startChampStage() {
  if (!champ || champ.done) return openCircuits();
  const car = carById(champ.car);
  startCircuit(circuitById(champ.next), { champ, car });
}

function openCircuits() {
  renderChampBox();
  loadChamp();
  const list = $("circuitList"); list.textContent = "";
  for (const c of CIRCUITS) {
    const ok = circuitUnlocked(c, profile);
    const t = trackById(c.theme);
    const b = document.createElement("button");
    b.className = "track"; b.disabled = !ok;
    const sw = document.createElement("span"); sw.className = "sw-big";
    sw.style.background = `linear-gradient(180deg, ${t.sky[0]}, ${t.sky[1]} 55%, ${t.ground} 56%, ${t.road})`;
    const txt = document.createElement("span");
    const name = document.createElement("b"); name.textContent = `${c.name} · ${c.laps} giri`;
    const d = document.createElement("span");
    const rec = profile.circuits && profile.circuits[c.id];
    const prev = CIRCUITS[CIRCUITS.indexOf(c) - 1];
    d.textContent = ok
      ? `${c.desc} Premio al 1°: ${fmtC(prizeFor(c, 1))}.${rec ? ` Miglior arrivo ${rec.best_pos}°${rec.best_lap ? `, giro ${fmtLap(Number(rec.best_lap))}` : ""}.` : ""}`
      : `Bloccato: arriva tra i primi 3 a ${prev.name}.`;
    txt.append(name, d); b.append(sw, txt);
    b.addEventListener("click", () => startCircuit(c));
    list.appendChild(b);
  }
  show("scrCircuits");
}
$("cBack").addEventListener("click", goHome);
const circuitHooks = {
  onToast: (text, kind) => toast(text, kind),
  onCountdown: (label) => { const h = $("hint"); h.textContent = label; h.className = "hint count"; h.hidden = false; },
  onStart: () => { setTimeout(() => { if (race && race.meta.kind === "circuit") $("hint").hidden = true; }, 700); },
  onFinish: (st) => { mode = "over"; clearInput(); finishCircuit(st); }
};
function setHudLabels(circuit) {
  $("lblDist").textContent = circuit ? "Posizione" : "Percorsi";
  $("lblTime").textContent = circuit ? "Giro" : "Tempo";
  $("cpChip").hidden = circuit; $("lapChip").hidden = !circuit; $("cCoins").hidden = circuit;
  const h = $("hint"); h.className = "hint"; h.textContent = "Tieni premuto GAS";
}
function startCircuit(c, ch) {
  endRace();
  const car = ch ? ch.car : selCar();
  race = new CircuitRace(renderer, trackById(c.theme), c, car, cfgFor(car), circuitHooks,
    { mobile, playerName: profile.name, aiNames: ch ? ch.champ.field.map((f) => f.n) : null });
  race.setAspect(W, H);
  race.meta = { car, circuit: c, kind: "circuit", champ: ch ? ch.champ : null };
  setHudLabels(true);
  mode = "race";
  show(null);
  $("raceUi").hidden = false;
  clearInput();
}
async function finishCircuit(st) {
  const { car, circuit } = race.meta;
  const beforeNext = CIRCUITS.filter((c) => circuitUnlocked(c, profile)).map((c) => c.id);
  $("oTitle").textContent = st.position === 1 ? "Vittoria!" : st.position <= 3 ? "Sul podio!" : "Gara finita";
  $("oDist").textContent = `${st.position}°`; $("oUnit").textContent = `su ${st.total}`;
  $("oL1").textContent = "Tempo"; $("oTime").textContent = fmtLap(st.time);
  $("oL2").textContent = "Giro migliore"; $("oCp").textContent = fmtLap(st.best);
  $("oL3").textContent = "Contatti"; $("oNear").textContent = st.contacts;
  $("oL4").textContent = "Premio"; $("oHit").textContent = fmtC(prizeFor(circuit, st.position));
  const ord = $("oOrder"); ord.textContent = ""; ord.hidden = false;
  const winner = st.order[0].time;
  st.order.forEach((o, i) => {
    const li = document.createElement("li"); if (o.isPlayer) li.className = "me";
    const pos = document.createElement("b"); pos.textContent = `${i + 1}.`;
    const nm = document.createElement("span"); nm.className = "on"; nm.textContent = o.name;
    const car = document.createElement("small"); car.textContent = carById(o.carId).name + (o.setup ? setupText(o.setup) : ""); nm.appendChild(car);
    const tm = document.createElement("span"); tm.className = "ot";
    tm.textContent = i === 0 ? fmtLap(o.time) : `+${(o.time - winner).toFixed(1).replace(".", ",")} s`;
    li.append(pos, nm, tm); ord.appendChild(li);
  });
  $("oUnlocks").textContent = "";
  $("oBoard").innerHTML = "";
  $("oChamp").hidden = true;
  const ch = race.meta.champ;
  $("again").textContent = ch ? "Prossima tappa" : "Riparti";
  $("oBoardTitle").textContent = ch ? "Top 10 · Campionato" : "Top 10 · Gare";
  show("scrOver");
  $("again").focus({ preventScroll: true });
  const save = $("oSave");
  save.textContent = "Salvo la gara…";
  if (ch) return finishChampStage(st, ch, save);
  const r = await api.submitCircuit(token, circuit.id, car.id, st.position, Math.round(st.time * 10) / 10, Math.round(st.best * 10) / 10);
  if (r && r.profile) {
    setProfile(r.profile, true);
    save.textContent = `Salvata: +${fmtC(r.earned)}.`;
    for (const c of CIRCUITS) if (!beforeNext.includes(c.id) && circuitUnlocked(c, profile)) { const d = document.createElement("div"); d.textContent = `Nuovo circuito sbloccato: ${c.name}`; $("oUnlocks").appendChild(d); }
  } else {
    save.textContent = ERRORS[r && r.error] || "Gara non salvata.";
    if (r && r.error === "no_session") { token = null; store.del("faro-token"); }
  }
  renderBoard($("oBoard"), await api.topRaces(), profile && profile.name, "races");
}

// compact finishing order for the championship record: name, player flag, time
function champOrder(order, position) {
  const o = order.map((x) => ({ n: x.name.slice(0, 14), p: x.isPlayer ? 1 : 0, t: Math.round(x.time * 10) / 10 }));
  const me = o.findIndex((x) => x.p);
  if (me >= 0 && me !== position - 1) { const [m] = o.splice(me, 1); o.splice(position - 1, 0, m); }
  return o;
}
async function finishChampStage(st, ch, save) {
  const r = await api.champStage(token, ch.id, st.position, Math.round(st.time * 10) / 10, Math.round(st.best * 10) / 10, champOrder(st.order, st.position));
  if (!(r && r.champ)) {
    save.textContent = (ERRORS[r && r.error] || "Tappa non salvata.") + " Puoi rifare la tappa.";
    if (r && r.error === "no_session") { token = null; store.del("faro-token"); }
    $("again").textContent = "Rifai la tappa";
    return;
  }
  setProfile(r.profile, true);
  champ = r.champ;
  showChampTable(st.position);
  save.textContent = `Tappa salvata: +${CH_POINTS[st.position - 1]} punti, +${fmtC(r.earned)}.`;
}
function showChampTable(lastPos) {
  const rows = champStandings(champ);
  const me = rows.findIndex((x) => x.isPlayer) + 1;
  $("oChamp").hidden = false;
  $("oChampTitle").textContent = champ.done ? `Campionato concluso: sei ${me}° con ${champ.points} punti` : `Campionato dopo ${champ.stage} tappe su 5`;
  standingsList($("oChampList"), rows);
  if (champ.done) {
    $("oTitle").textContent = me === 1 ? "Campione!" : `Campionato: ${me}°`;
    $("again").textContent = "Nuovo campionato";
    api.topChamp().then((rows2) => renderBoard($("oBoard"), rows2, profile && profile.name, "champ"));
  } else {
    $("again").textContent = `Tappa ${champ.stage + 1}: ${circuitById(champ.next).name}`;
  }
}
// leaving a championship stage early counts as retiring: 6th, 0 points, time penalty
async function retireChampStage() {
  const ch = race.meta.champ;
  const order = race.cars.slice().sort((a, b) => b.s - a.s).filter((c) => !c.isPlayer)
    .map((c) => ({ n: c.name.slice(0, 14), p: 0, t: null }));
  order.push({ n: profile.name.slice(0, 14), p: 1, t: null });
  const r = await api.champStage(token, ch.id, null, null, null, order, true);
  if (r && r.champ) { champ = r.champ; if (r.profile) setProfile(r.profile, true); }
}

// short description of an AI setup: only the non-stock parts
function setupText(cfg) {
  const bits = [];
  for (const k of PART_ORDER) {
    const o = PARTS[k].options;
    if (cfg[k] && cfg[k] !== o[k === "tyres" ? 1 : k === "gears" ? 1 : 0].id && k !== "rims") bits.push(o.find((x) => x.id === cfg[k]).label.toLowerCase());
  }
  return bits.length ? " · " + bits.join(", ") : "";
}

// ------------------------------------------------------------------ race
const hooks = {
  onToast: (text, kind) => toast(text, kind),
  onStart: () => { $("hint").hidden = true; },
  onFinish: (st) => { mode = "over"; clearInput(); finishRun(st); }
};
function startRace() {
  endRace();
  const car = selCar(), track = selTrack();
  race = new Race(renderer, track, car, cfgFor(car), hooks, { mobile });
  race.setAspect(W, H);
  race.meta = { car, track, kind: "endless" };
  setHudLabels(false);
  mode = "race";
  show(null);
  $("raceUi").hidden = false;
  $("hint").hidden = false;
  clearInput();
}
function endRace() {
  if (race) { race.dispose(); race = null; }
  $("raceUi").hidden = true;
  clearInput();
}
async function finishRun(st) {
  const { car, track } = race.meta;
  const before = { cars: CARS.filter((c) => carUnlocked(c, profile)).map((c) => c.id), tracks: TRACKS.filter((t) => trackUnlocked(t, profile)).map((t) => t.id) };
  $("oTitle").textContent = "Tempo scaduto";
  $("oDist").textContent = st.distance.toLocaleString("it-IT"); $("oUnit").textContent = "m";
  $("oL1").textContent = "Tempo"; $("oL2").textContent = "Traguardi"; $("oL3").textContent = "Scarti"; $("oL4").textContent = "Botti";
  $("oOrder").hidden = true; $("oChamp").hidden = true; $("again").textContent = "Riparti";
  $("oTime").textContent = Math.round(st.time) + " s";
  $("oCp").textContent = st.cps; $("oNear").textContent = st.near; $("oHit").textContent = st.crashes;
  $("oUnlocks").textContent = "";
  $("oBoardTitle").textContent = "Top 10 · Pista infinita";
  $("oBoard").innerHTML = "";
  show("scrOver");
  $("again").focus({ preventScroll: true });
  const save = $("oSave");
  if (st.distance < 1 || st.time < 1) { save.textContent = ""; return; }
  save.textContent = "Salvo la partita…";
  const r = await api.submitRun(token, track.id, car.id, st.distance, Math.round(st.time * 10) / 10, st.cps, st.coins);
  if (r && r.profile) {
    const prevBest = (profile.best && profile.best[track.id] && profile.best[track.id].best_m) || 0;
    setProfile(r.profile, true);
    if (st.distance > prevBest) $("oTitle").textContent = "Nuovo record su questa pista!";
    save.textContent = `Salvata: sei ${r.rank}° su ${track.name}. Guadagno: +${fmtC(r.earned)} (${st.coins} monete raccolte).`;
    const box = $("oUnlocks");
    for (const c of CARS) if (!before.cars.includes(c.id) && carUnlocked(c, profile)) { const d = document.createElement("div"); d.textContent = `Nuova auto sbloccata: ${c.name}`; box.appendChild(d); }
    for (const t of TRACKS) if (!before.tracks.includes(t.id) && trackUnlocked(t, profile)) { const d = document.createElement("div"); d.textContent = `Nuova pista sbloccata: ${t.name}`; box.appendChild(d); }
  } else {
    save.textContent = ERRORS[r && r.error] || "Partita non salvata.";
    if (r && r.error === "no_session") { token = null; store.del("faro-token"); }
  }
  renderBoard($("oBoard"), await api.topEndless(), profile && profile.name, "endless");
}
function pause() {
  if (mode !== "race") return;
  mode = "paused"; clearInput();
  $("pauseNote").hidden = !(race && race.meta.champ && race.state !== "finished");
  show("scrPause"); $("resume").focus({ preventScroll: true });
}
function resume() { if (mode !== "paused") return; show(null); mode = "race"; }
$("pauseBtn").addEventListener("click", pause);
$("resume").addEventListener("click", resume);
$("quit").addEventListener("click", async () => {
  const retire = race && race.meta.champ && race.state !== "finished";
  if (retire) { await retireChampStage(); endRace(); openCircuits(); return; }
  goHome();
});
$("again").addEventListener("click", () => {
  if (!token) { showLogin(ERRORS.no_session); return; }
  if (race && race.meta.champ) { if (champ && champ.done) newChamp(); else startChampStage(); return; }
  if (race && race.meta.kind === "circuit") startCircuit(race.meta.circuit); else startRace();
});
$("toBox").addEventListener("click", () => { if (!token) { showLogin(ERRORS.no_session); return; } goHome(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

// ------------------------------------------------------------------ HUD
const el = { coins: $("cCoins"), spd: $("spd"), dst: $("dst"), tim: $("tim"), gT: $("gtime"), gS: $("gspd"), cp: $("cpLeft"), turbo: $("cTurbo"), shield: $("cShield"), oil: $("cOil"), off: $("cOff") };
let toastTimer = 0;
function toast(text, kind) {
  const t = $("toast");
  t.textContent = text; t.className = "toast"; void t.offsetWidth; t.className = "toast show " + (kind || "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = "toast"; }, 1200);
}
const SEV_LABEL = ["veloce", "media", "stretta"];
function updateCorner(h) {
  const chip = $("cornerChip"), c = h.corner;
  const show = c && c.dist > 0 && c.dist <= 170 && h.state !== "over" && h.state !== "finished";
  chip.hidden = !show;
  if (!show) return;
  const d = c.dist > 125 ? "150 m" : c.dist > 75 ? "100 m" : c.dist > 35 ? "50 m" : "ora";
  chip.textContent = `${c.dir > 0 ? "→" : "←"} ${c.dir > 0 ? "Destra" : "Sinistra"} ${SEV_LABEL[c.sev]} · ${d}`;
  chip.className = "chip corner sev" + c.sev;
}
function drawMinimap() {
  const cv = $("minimap");
  const noMap = !race || !race.minimap;
  $("rearBtn").classList.toggle("nomap", noMap);
  if (noMap) { cv.hidden = true; return; }
  cv.hidden = false;
  const m = race.minimap(), g = cv.getContext("2d"), S = cv.width;
  if (!race.mapBox) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of m.path) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const span = Math.max(x1 - x0, z1 - z0) || 1;
    race.mapBox = { x0, z0, k: (S - 28) / span, ox: (S - (x1 - x0) * ((S - 28) / span)) / 2, oz: (S - (z1 - z0) * ((S - 28) / span)) / 2 };
  }
  const b = race.mapBox;
  const P = (x, z) => [b.ox + (x - b.x0) * b.k, b.oz + (z - b.z0) * b.k];
  g.clearRect(0, 0, S, S);
  g.fillStyle = "rgba(22,20,28,0.72)"; g.beginPath(); g.roundRect(0, 0, S, S, 18); g.fill();
  g.lineJoin = "round"; g.lineCap = "round";
  g.beginPath(); m.path.forEach(([x, z], i) => { const [px, pz] = P(x, z); i ? g.lineTo(px, pz) : g.moveTo(px, pz); }); g.closePath();
  g.strokeStyle = "rgba(255,244,226,0.25)"; g.lineWidth = 12; g.stroke();
  g.strokeStyle = "#fff4e2"; g.lineWidth = 4; g.stroke();
  const [sx, sz] = P(m.path[0][0], m.path[0][1]);
  g.fillStyle = "#1d1d1f"; g.fillRect(sx - 6, sz - 2, 12, 4);
  for (const c of m.cars.filter((c) => !c.isPlayer)) {
    const [x, z] = P(c.x, c.z);
    g.fillStyle = c.color; g.strokeStyle = "#1d1d1f"; g.lineWidth = 2.5;
    g.beginPath(); g.arc(x, z, 7, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  const me = m.cars.find((c) => c.isPlayer);
  if (me) { const [x, z] = P(me.x, me.z); g.fillStyle = "#ffb23e"; g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.arc(x, z, 10, 0, Math.PI * 2); g.fill(); g.stroke(); }
}
function updateHud() {
  const h = race.hud();
  updateCorner(h);
  drawMinimap();
  if (h.circuit) {
    el.spd.textContent = h.kmh;
    el.dst.textContent = `${h.pos}°`; $("emDist").textContent = `/${h.total}`;
    el.tim.textContent = `${h.lap}`; $("emTime").textContent = `/${h.laps}`;
    $("lapChip").textContent = `Giro ${fmtLap(h.lapTime)} · Migliore ${fmtLap(h.best)}`;
    el.gT.classList.remove("low"); el.gS.classList.remove("turbo");
    el.turbo.hidden = true; el.shield.hidden = true; el.oil.hidden = true; el.off.hidden = !h.off;
    return;
  }
  $("emDist").textContent = "m"; $("emTime").textContent = "s";
  el.coins.textContent = fmtC(h.coins);
  el.spd.textContent = h.kmh; el.dst.textContent = h.dist; el.tim.textContent = h.time.toFixed(1); el.cp.textContent = h.toCp;
  el.gT.classList.toggle("low", h.state === "run" && h.time < 5);
  el.gS.classList.toggle("turbo", h.turbo > 0);
  el.turbo.hidden = !(h.turbo > 0); if (h.turbo > 0) el.turbo.textContent = "Turbo " + h.turbo.toFixed(1);
  el.shield.hidden = !h.shield; el.oil.hidden = !h.slip; el.off.hidden = !h.off;
}

// ------------------------------------------------------------------ input
function clearInput() { input.gas = input.brake = input.left = input.right = false; document.querySelectorAll(".btn.on").forEach((b) => b.classList.remove("on")); }
const keyMap = { ArrowUp: "gas", KeyW: "gas", Space: "gas", ArrowDown: "brake", KeyS: "brake", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT")) return;
  if (e.code === "KeyP" || e.code === "Escape") { if (mode === "paused") resume(); else pause(); return; }
  const k = keyMap[e.code];
  if (k && mode === "race") { e.preventDefault(); input[k] = true; }
});
addEventListener("keyup", (e) => { const k = keyMap[e.code]; if (k) input[k] = false; });
addEventListener("blur", clearInput);
function bindPad(btn, key) {
  const down = (e) => { e.preventDefault(); if (mode !== "race") return; try { btn.setPointerCapture(e.pointerId); } catch (_) {} input[key] = true; btn.classList.add("on"); };
  const up = () => { input[key] = false; btn.classList.remove("on"); };
  btn.addEventListener("pointerdown", down); btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up); btn.addEventListener("lostpointercapture", up);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}
{
  const rb = $("rearBtn");
  const on = (e) => { e.preventDefault(); if (race) race.rearView = true; rb.classList.add("on"); try { rb.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = () => { if (race) race.rearView = false; rb.classList.remove("on"); };
  rb.addEventListener("pointerdown", on); rb.addEventListener("pointerup", off); rb.addEventListener("pointercancel", off); rb.addEventListener("lostpointercapture", off);
  rb.addEventListener("contextmenu", (e) => e.preventDefault());
  addEventListener("keydown", (e) => { if (e.code === "KeyC" && race && !(e.target && e.target.tagName === "INPUT")) race.rearView = true; });
  addEventListener("keyup", (e) => { if (e.code === "KeyC" && race) race.rearView = false; });
}
bindPad($("bG"), "gas"); bindPad($("bB"), "brake"); bindPad($("bL"), "left"); bindPad($("bR"), "right");
stage.addEventListener("contextmenu", (e) => e.preventDefault());

// ------------------------------------------------------------------ tilt steering + fullscreen
// Steering by tilting the phone like a wheel. The angle comes from gravity seen in the screen's own axes,
// so it works in portrait and both landscapes, held upright or leaned back. Level phone = straight.
let ctrl = store.get("faro-ctrl") === "tilt" ? "tilt" : "arrows";
let tiltOk = false, tiltListening = false, tiltAngle = 0;
const TILT_FULL = 22 * Math.PI / 180, TILT_DEAD = 2.5 * Math.PI / 180;
function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
  const gx = Math.cos(b) * Math.sin(g), gy = -Math.sin(b);              // gravity in the device's x/y axes
  const ang = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * Math.PI / 180;
  const gxs = gx * Math.cos(ang) - gy * Math.sin(ang);                  // ...along the screen's horizontal axis
  tiltAngle = Math.asin(Math.max(-1, Math.min(1, gxs)));
  tiltOk = true;
}
function listenTilt() {
  if (tiltListening) return;
  tiltListening = true;
  addEventListener("deviceorientation", onOrient);
}
// must run inside a tap: iPhone asks for permission to read the motion sensors
function askTilt() {
  const D = window.DeviceOrientationEvent;
  if (!D) return Promise.resolve(false);
  if (typeof D.requestPermission === "function") {
    return D.requestPermission().then((r) => { if (r === "granted") { listenTilt(); return true; } return false; }).catch(() => false);
  }
  listenTilt();
  return Promise.resolve(true);
}
function tiltSteer() {
  if (ctrl !== "tilt" || !tiltOk) return null;
  let a = tiltAngle;
  if (Math.abs(a) < TILT_DEAD) return 0;
  a -= Math.sign(a) * TILT_DEAD;
  return Math.max(-1, Math.min(1, a / (TILT_FULL - TILT_DEAD)));
}
function renderCtrl(msg) {
  document.querySelectorAll("#ctrlOpts .opt").forEach((b) => { const on = b.dataset.ctrl === ctrl; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  const n = $("ctrlNote");
  n.textContent = msg || (ctrl === "tilt" ? "Gira il telefono come un volante. Telefono dritto = auto dritta." : "");
  n.hidden = !n.textContent;
  document.body.classList.toggle("tilt-mode", ctrl === "tilt" && tiltOk);
}
document.querySelectorAll("#ctrlOpts .opt").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.ctrl === "arrows") { ctrl = "arrows"; store.set("faro-ctrl", ctrl); renderCtrl(); return; }
  askTilt().then((ok) => {
    if (!ok) { ctrl = "arrows"; renderCtrl("Il telefono non dà accesso al giroscopio: restano le frecce."); return; }
    ctrl = "tilt"; store.set("faro-ctrl", ctrl);
    renderCtrl("Attivo il giroscopio…");
    setTimeout(() => { if (ctrl === "tilt" && !tiltOk) { ctrl = "arrows"; store.set("faro-ctrl", ctrl); renderCtrl("Nessun giroscopio trovato su questo dispositivo: restano le frecce."); } else renderCtrl(); }, 1200);
  });
}));
// on a reload the permission must be asked again with a tap (iPhone): do it on the first tap anywhere
if (ctrl === "tilt") {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") addEventListener("pointerup", () => askTilt().then(() => renderCtrl()), { once: true });
  else listenTilt();
  setTimeout(() => renderCtrl(), 1500);
}

const fsEl = document.documentElement;
const fsCan = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
async function toggleFull() {
  try {
    if (fsOn()) { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); return; }
    if (fsEl.requestFullscreen) await fsEl.requestFullscreen({ navigationUI: "hide" }); else if (fsEl.webkitRequestFullscreen) fsEl.webkitRequestFullscreen();
    if (mobile && screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape").catch(() => {});
  } catch (e) { /* refused by the browser: nothing to do */ }
}
function renderFs() {
  $("fsBtn").hidden = !fsCan; $("fsChip").hidden = !fsCan || !mobile;
  $("fsBtn").textContent = fsOn() ? "Esci da schermo intero" : "Schermo intero (orizzontale)";
}
$("fsBtn").addEventListener("click", toggleFull);
$("fsChip").addEventListener("click", toggleFull);
document.addEventListener("fullscreenchange", renderFs);
document.addEventListener("webkitfullscreenchange", renderFs);
renderFs(); renderCtrl();
if (!fsCan && mobile) {
  const n = $("ctrlNote");
  if (!n.textContent) { n.textContent = "Per giocare a tutto schermo: Condividi → Aggiungi alla schermata Home, poi apri il gioco da lì."; n.hidden = false; }
}

// ------------------------------------------------------------------ loop
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (race && (mode === "race" || mode === "over")) {
    showroom.active = false;
    acc += dt;
    input.tilt = tiltSteer();
    while (acc >= STEP) { race.update(STEP, input); acc -= STEP; }
    race.render(dt, now);
    updateHud();
  } else if (race && mode === "paused") {
    acc = 0;
    race.render(0, now);
  } else {
    showroom.active = true;
    showroom.render(dt);
  }
  requestAnimationFrame(frame);
}

async function boot() {
  resize();
  $("loading").hidden = true;
  requestAnimationFrame(frame);
  if (token) {
    const r = await api.profile(token);
    if (r.profile) { setProfile(r.profile); goHome(); return; }
    if (r.error === "network") { showLogin(ERRORS.network); return; }
    store.del("faro-token"); token = null;
  }
  showLogin();
}
boot();

// hook for automated checks only
window.__faro = {
  get mode() { return mode; }, input,
  get race() { return race; },
  fakeLogin(p) { token = "test"; setProfile(p); goHome(); },
  startRace, openGarage, openTracks, startCircuit: (id) => startCircuit(circuitById(id))
};
