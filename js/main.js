import * as THREE from "three";
import {
  CARS, TRACKS, PARTS, PART_ORDER, COLORS, carById, trackById, cleanConfig, performance as perfOf,
  carUnlocked, trackUnlocked, unlockText, priceOf, ownsCar, ownsPart, coinsEarned,
  CIRCUITS, circuitById, circuitUnlocked, prizeFor
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
const input = { gas: false, brake: false, left: false, right: false };

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
function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; }

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
// kind: "endless" (best distance on any track) or "races" (championship points)
function renderBoard(ol, rows, highlightName, kind) {
  ol.textContent = "";
  const li0 = (text) => { const li = document.createElement("li"); li.className = "empty"; li.textContent = text; ol.appendChild(li); };
  if (!Array.isArray(rows)) return li0("Classifica non raggiungibile in questo momento.");
  if (!rows.length) return li0(kind === "races" ? "Ancora nessuna gara conclusa. Il primo posto è libero." : "Ancora nessun risultato. Il primo posto è libero.");
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (highlightName && r.name.toLowerCase() === highlightName.toLowerCase()) li.className = "me";
    const pos = document.createElement("span"); pos.className = "pos"; pos.textContent = i + 1;
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = r.name;
    const sub = document.createElement("small");
    const m = document.createElement("span"); m.className = "m";
    const t = document.createElement("span"); t.className = "t";
    if (kind === "races") {
      sub.textContent = `${r.circuits}/5 circuiti`;
      m.textContent = `${r.points} pt`;
      t.textContent = r.wins === 1 ? "1 vittoria" : `${r.wins} vittorie`;
    } else {
      sub.textContent = `${trackById(r.track).name} · ${carById(r.car).name}`;
      m.textContent = fmtM(r.distance_m);
      t.textContent = Math.round(r.time_s) + " s";
    }
    nm.appendChild(sub);
    li.append(pos, nm, m, t); ol.appendChild(li);
  });
}
async function openBoard(kind) {
  kind = kind === "races" ? "races" : "endless";
  const tabs = $("boardTabs"); tabs.textContent = "";
  for (const [k, label] of [["endless", "Pista infinita"], ["races", "Gare"]]) {
    const b = document.createElement("button");
    b.className = "tab" + (k === kind ? " on" : ""); b.textContent = label; b.setAttribute("role", "tab");
    b.addEventListener("click", () => openBoard(k));
    tabs.appendChild(b);
  }
  $("boardNote").textContent = kind === "races"
    ? "Campionato: per ogni circuito conta il tuo miglior arrivo (25, 18, 15, 12, 10, 8 punti dal 1° al 6°)."
    : "Il miglior risultato di ogni pilota, su qualsiasi pista.";
  show("scrBoard");
  const ol = $("boardList");
  ol.innerHTML = '<li class="empty">Carico…</li>';
  renderBoard(ol, kind === "races" ? await api.topRaces() : await api.topEndless(), profile && profile.name, kind);
}
$("bBack").addEventListener("click", goHome);

// ------------------------------------------------------------------ circuits
function openCircuits() {
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
      ? `${c.desc} Premio al 1°: ${fmtC(prizeFor(c, 1))}.${rec ? ` Miglior arrivo ${rec.best_pos}°, giro ${fmtLap(Number(rec.best_lap))}.` : ""}`
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
function startCircuit(c) {
  endRace();
  const car = selCar();
  race = new CircuitRace(renderer, trackById(c.theme), c, car, cfgFor(car), circuitHooks, { mobile, playerName: profile.name });
  race.setAspect(W, H);
  race.meta = { car, circuit: c, kind: "circuit" };
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
  st.order.forEach((o, i) => { const li = document.createElement("li"); if (o.isPlayer) li.className = "me"; const b = document.createElement("b"); b.textContent = `${i + 1}.`; li.append(b, document.createTextNode(o.name)); ord.appendChild(li); });
  $("oUnlocks").textContent = "";
  $("oBoardTitle").textContent = "Top 10 · Gare";
  $("oBoard").innerHTML = "";
  show("scrOver");
  $("again").focus({ preventScroll: true });
  const save = $("oSave");
  save.textContent = "Salvo la gara…";
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
  $("oOrder").hidden = true;
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
function pause() { if (mode !== "race") return; mode = "paused"; clearInput(); show("scrPause"); $("resume").focus({ preventScroll: true }); }
function resume() { if (mode !== "paused") return; show(null); mode = "race"; }
$("pauseBtn").addEventListener("click", pause);
$("resume").addEventListener("click", resume);
$("quit").addEventListener("click", goHome);
$("again").addEventListener("click", () => {
  if (!token) { showLogin(ERRORS.no_session); return; }
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
function updateHud() {
  const h = race.hud();
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
bindPad($("bG"), "gas"); bindPad($("bB"), "brake"); bindPad($("bL"), "left"); bindPad($("bR"), "right");
stage.addEventListener("contextmenu", (e) => e.preventDefault());

// ------------------------------------------------------------------ loop
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (race && (mode === "race" || mode === "over")) {
    showroom.active = false;
    acc += dt;
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
