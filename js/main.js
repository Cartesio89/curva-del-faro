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
import { Sound, engineKind } from "./audio.js";
import { initOnline } from "./online.js";

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
const SCREENS = ["scrLogin", "scrHome", "scrGarage", "scrTracks", "scrCircuits", "scrBoard", "scrRoom", "scrPre", "scrPause", "scrOver"];
function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id === "scrOver") sound.stopAll();
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
    online.start();
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
  online.stop();
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
// One stat: the grey part is the car as it leaves the factory (never moves for a given car);
// green = what your parts add on top, red = what they take away. The numbers say by how much.
function statBar(label, frac, baseFrac, text, delta, good, extra) {
  const row = document.createElement("div"); row.className = "bar";
  const a = document.createElement("span"); a.textContent = label;
  const t = document.createElement("span"); t.className = "track-bar";
  const cf = (f) => Math.max(0.04, Math.min(1, f));
  const now = cf(frac), base = cf(baseFrac);
  const seg = (cls, from, to) => { const e = document.createElement("span"); e.className = "seg " + cls; e.style.left = (from * 100).toFixed(1) + "%"; e.style.width = (Math.max(0, to - from) * 100).toFixed(1) + "%"; return e; };
  t.appendChild(seg("base", 0, Math.min(now, base)));
  if (now > base + 0.002) t.appendChild(seg("gain", base, now));
  if (now < base - 0.002) t.appendChild(seg("loss", now, base));
  const b = document.createElement("b"); b.textContent = text;
  if (delta) { const d = document.createElement("small"); d.className = good ? "up" : "down"; d.textContent = delta + " vs serie"; b.appendChild(d); }
  if (extra) { const d = document.createElement("small"); d.className = "vsnow"; d.textContent = extra; b.appendChild(d); }
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
  if (bits.length) return bits.join(", ");
  return key === "rims" ? "solo estetica" : "base: nessun bonus né malus";
}
function perfBars(car, cfg, nowCfg) {
  const p = perfOf(car, cfg), r = perfOf(car, cleanConfig(car, null));
  const n = nowCfg ? perfOf(car, nowCfg) : null;     // when trying a part: what you have mounted now
  const fTop = (v) => (v - 150) / 260, fAcc = (v) => (13 - v) / 11, fGrip = (v) => (v - 8) / 14;
  const num = (x, dec) => x.toFixed(dec).replace(".", ",");
  const sg = (x) => (x > 0 ? "+" : "−");
  const dTop = Math.round(p.topKmh - r.topKmh), dAcc = p.acc0100 - r.acc0100, dGrip = (p.grip - r.grip) / 9.81;
  const nTop = n ? Math.round(p.topKmh - n.topKmh) : 0, nAcc = n ? p.acc0100 - n.acc0100 : 0, nGrip = n ? (p.grip - n.grip) / 9.81 : 0;
  const cap = document.createElement("p"); cap.className = "cmp";
  cap.innerHTML = '<span><i class="lg base"></i>di serie</span><span><i class="lg gain"></i>guadagno pezzi</span><span><i class="lg loss"></i>perdita pezzi</span>';
  if (n) { const x = document.createElement("span"); x.className = "trying"; x.textContent = "In prova: in blu la differenza da quello montato."; cap.appendChild(x); }
  return [cap,
    statBar("Velocità", fTop(p.topKmh), fTop(r.topKmh), Math.round(p.topKmh) + " km/h", dTop ? sg(dTop) + Math.abs(dTop) + " km/h" : "", dTop > 0,
      n && nTop ? `${sg(nTop)}${Math.abs(nTop)} km/h vs ora` : ""),
    statBar("0-100", fAcc(p.acc0100), fAcc(r.acc0100), num(p.acc0100, 1) + " s", Math.abs(dAcc) >= 0.05 ? sg(dAcc) + num(Math.abs(dAcc), 1) + " s" : "", dAcc < 0,
      n && Math.abs(nAcc) >= 0.05 ? `${sg(nAcc)}${num(Math.abs(nAcc), 1)} s vs ora` : ""),
    statBar("Tenuta", fGrip(p.grip), fGrip(r.grip), num(p.grip / 9.81, 2) + " g", Math.abs(dGrip) >= 0.005 ? sg(dGrip) + num(Math.abs(dGrip), 2) + " g" : "", dGrip > 0,
      n && Math.abs(nGrip) >= 0.005 ? `${sg(nGrip)}${num(Math.abs(nGrip), 2)} g vs ora` : "")
  ];
}
let gAction = null;
let gCat = "engine";
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
  st.append(...perfBars(car, cfg, preview ? cfgFor(car) : null));
  // parts: one category at a time (tabs), each option a big button with its status and effect
  const canEdit = !locked && owned;
  const cats = [...PART_ORDER, "color"];
  if (!cats.includes(gCat)) gCat = "engine";
  const tabs = $("gCats"); tabs.textContent = "";
  for (const key of cats) {
    const t = document.createElement("button");
    t.className = "ptab" + (key === gCat ? " on" : "");
    t.textContent = key === "color" ? "Colore" : PARTS[key].label;
    t.setAttribute("role", "tab"); t.setAttribute("aria-selected", key === gCat ? "true" : "false");
    t.addEventListener("click", () => { gCat = key; if (preview && preview.key !== key) preview = null; renderGarage(!!preview); t.scrollIntoView({ block: "nearest", inline: "center" }); });
    tabs.appendChild(t);
  }
  const parts = $("gParts"); parts.textContent = "";
  const mounted = cfgFor(car);
  const pick = (key, value, label) => {
    const have = ownsPart(profile, car, key, value);
    if (!canEdit) return;
    if (have) {
      preview = null;
      if (mounted[key] !== value) { setPart(car, key, value); toastMenu(`Montato: ${key === "color" ? "colore" : PARTS[key].label.toLowerCase() + " " + label.toLowerCase()}`); }
      else renderGarage(true);
    } else { preview = { car: car.id, key, value, label: key === "color" ? "colore" : `${PARTS[key].label.toLowerCase()} ${label.toLowerCase()}`, short: key === "color" ? "colore" : label }; renderGarage(true); }
  };
  const status = (key, value) => {
    const have = ownsPart(profile, car, key, value);
    if (mounted[key] === value) return { cls: "mounted", text: "Montato" };
    if (preview && preview.key === key && preview.value === value) return { cls: "trying", text: `In prova · ${fmtC(priceOf(car, key, value))}` };
    if (have) return { cls: "mine", text: "Tuo · tocca per montare" };
    return { cls: "shop", text: fmtC(priceOf(car, key, value)) };
  };
  if (gCat === "color") {
    const sws = document.createElement("div"); sws.className = "swatches big";
    for (const c of COLORS) {
      const b = document.createElement("button");
      const st = status("color", c);
      b.className = "sw " + st.cls + (cfg.color === c ? " on" : "");
      b.style.background = c; b.setAttribute("aria-label", `Colore: ${st.text}`); b.disabled = !canEdit;
      b.addEventListener("click", () => pick("color", c, ""));
      sws.appendChild(b);
    }
    const leg = document.createElement("p"); leg.className = "note small-note";
    leg.textContent = `Colori con la M: da comprare (${fmtC(priceOf(car, "color", COLORS[1]))}). Gli altri sono tuoi: tocca per montarli.`;
    parts.append(sws, leg);
  } else {
    const grid = document.createElement("div"); grid.className = "popts";
    for (const o of PARTS[gCat].options) {
      const st = status(gCat, o.id);
      const b = document.createElement("button");
      b.className = "popt " + st.cls + (cfg[gCat] === o.id ? " on" : "");
      b.disabled = !canEdit;
      const n = document.createElement("b"); n.textContent = o.label;
      const s1 = document.createElement("small"); s1.className = "st"; s1.textContent = st.text;
      const s2 = document.createElement("small"); s2.className = "fx"; s2.textContent = effectText(gCat, o.id);
      b.append(n, s1, s2);
      b.addEventListener("click", () => pick(gCat, o.id, o.label));
      grid.appendChild(b);
    }
    parts.appendChild(grid);
  }
  if (!canEdit) {
    const n = document.createElement("p"); n.className = "note small-note";
    n.textContent = locked ? "Sblocca l'auto per cambiarle i pezzi." : "Compra l'auto per cambiarle i pezzi.";
    parts.appendChild(n);
  }

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
    use.textContent = `Compra ${preview.short || preview.label} · ${fmtC(price)}`;
    gAction = { item: `${preview.key}:${preview.value}`, price, key: preview.key, value: preview.value }; use.disabled = coins < price;
  } else if (garage.sel === car.id) use.textContent = "In uso";
  else { use.textContent = "Usa questa auto"; use.disabled = false; gAction = { use: true }; }
  if (gAction && gAction.price != null && coins < gAction.price) msg.textContent = (preview ? `${effectText(preview.key, preview.value)}. ` : "") + `Hai ${fmtC(coins)}: ti mancano ${fmtC(gAction.price - coins)}.`;
  else if (preview) msg.textContent = `In prova: ${preview.label}. Per annullare tocca il pezzo montato.`;
  else msg.textContent = "";
  msg.hidden = !msg.textContent;
  msg.classList.toggle("pv", !!preview && !(gAction && gAction.price != null && coins < gAction.price));
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
const kmh1 = (v) => (v > 0 ? Math.round(v * 10) / 10 : null);
const fmtKmh = (v) => (v == null ? "v.max n.d." : `${Number(v).toLocaleString("it-IT", { maximumFractionDigits: 1 })} km/h max`);
function showVmax(v) { const e = $("oVmax"); e.hidden = !(v > 0); e.textContent = v > 0 ? `Velocità massima raggiunta: ${Math.round(v)} km/h` : ""; }
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
    if (kind === "speed") {
      const where = r.mode === "endless" ? trackById(r.place).name : (circuitById(r.place) || { name: r.place }).name;
      sub.textContent = `${carById(r.car).name} · ${r.mode === "endless" ? "pista infinita" : r.mode === "challenge" ? "sfida" : "gara"} ${where}`;
      m.textContent = `${Number(r.max_kmh).toLocaleString("it-IT", { maximumFractionDigits: 1 })} km/h`;
      t.textContent = "";
    } else if (kind === "challenges") {
      sub.textContent = `${r.challenges === 1 ? "1 sfida" : r.challenges + " sfide"} · ${r.races === 1 ? "1 gara" : r.races + " gare"}`;
      m.textContent = `${r.wins} ${r.wins === 1 ? "vittoria" : "vittorie"}`;
      t.textContent = r.races ? Math.round((r.wins / r.races) * 100) + "%" : "";
    } else if (kind === "champ") {
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
    // second line: top speed reached in that record (overall boards: the highest of the races counted;
    // records set before the speed was measured, before 12 nov, show "v.max n.d.") and when it was set
    const meta = document.createElement("small"); meta.className = "when";
    const bits = [];
    if (kind !== "speed") bits.push(fmtKmh(r.max_kmh));
    if (r.created_at) {
      const d = new Date(r.created_at);
      if (!isNaN(d)) {
        const agg = kind === "races" || kind === "challenges";
        bits.push((agg ? "ultima gara " : "") + d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined })
          + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
      }
    }
    meta.textContent = bits.join(" · ");
    nm.appendChild(sub);
    if (meta.textContent) nm.appendChild(meta);
    li.append(pos, nm, m, t); ol.appendChild(li);
  });
}
// kind: "endless" | "races"; filter: track id / circuit id, or "" for the overall board
async function openBoard(kind, filter = "", car = "") {
  kind = ["races", "champ", "challenges", "speed"].includes(kind) ? kind : "endless";
  const tabs = $("boardTabs"); tabs.textContent = "";
  for (const [k, label] of [["endless", "Pista infinita"], ["races", "Gare"], ["champ", "Campionato"], ["challenges", "Sfide"], ["speed", "Velocità"]]) {
    const b = document.createElement("button");
    b.className = "tab" + (k === kind ? " on" : ""); b.textContent = label; b.setAttribute("role", "tab");
    b.addEventListener("click", () => openBoard(k, "", car));
    tabs.appendChild(b);
  }
  const fl = $("boardFilters"); fl.textContent = "";
  const opts = kind === "champ" || kind === "challenges" ? []
    : kind === "races"
    ? [["", "Generale"], ...CIRCUITS.map((c) => [c.id, c.name])]
    : kind === "speed"
    ? [["", "Ovunque"], ...TRACKS.map((t) => [t.id, t.name]), ...CIRCUITS.map((c) => [c.id, c.name])]
    : [["", "Tutte le piste"], ...TRACKS.map((t) => [t.id, t.name])];
  for (const [id, label] of opts) {
    const b = document.createElement("button");
    b.className = "opt" + (id === filter ? " on" : ""); b.textContent = label;
    b.addEventListener("click", () => openBoard(kind, id, car));
    fl.appendChild(b);
  }
  fl.hidden = !opts.length;
  // car filter, on every board
  const sel = $("boardCar");
  if (!sel.options.length) {
    sel.appendChild(new Option("Tutte le auto", ""));
    for (const c of CARS) sel.appendChild(new Option(c.name, c.id));
    sel.addEventListener("change", () => openBoard(sel.dataset.kind, sel.dataset.filter, sel.value));
  }
  sel.value = car; sel.dataset.kind = kind; sel.dataset.filter = filter;
  const withCar = car ? ` Solo ${carById(car).name}.` : "";
  $("boardNote").textContent = (kind === "speed"
    ? "Le 10 velocità più alte mai raggiunte, in qualunque modalità (misurate dal 12 novembre)."
    : kind === "challenges"
    ? "Gare online contro altri giocatori veri (le IA riempiono la griglia). Vince chi arriva primo tra i giocatori veri."
    : kind === "champ"
    ? "I 10 migliori campionati conclusi: prima i punti totali delle 5 tappe, poi il tempo totale sommato."
    : kind === "races"
    ? (filter ? "Le 10 migliori gare su questo circuito: prima il piazzamento, poi il tempo totale."
              : "Generale: per ogni circuito conta il miglior arrivo di ciascun pilota (25, 18, 15, 12, 10, 8 punti dal 1° al 6°).")
    : (filter ? "I 10 migliori risultati su questa pista." : "I 10 migliori risultati su tutte le piste.")) + withCar;
  show("scrBoard");
  const ol = $("boardList");
  ol.innerHTML = '<li class="empty">Carico…</li>';
  const k = kind === "races" && filter ? "circuit" : kind;
  const rows = await api.board(k, filter, car);
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
  onFinish: (st) => {
    if (st.mp) { online.onMyFinish(st); return; }   // online: wait for everybody, the car keeps rolling
    mode = "over"; clearInput(); finishCircuit(st);
  },
  onTake: (id) => online.onTake(id)
};
// online challenge race: same car and setup for every real player, grid from the host
function startMpRace({ circuit, car, setup, grid, hostAI, items }) {
  endRace();
  race = new CircuitRace(renderer, trackById(circuit.theme), circuit, car, setup, circuitHooks,
    { mobile, playerName: profile.name, grid, hostAI, items });
  race.setAspect(W, H);
  race.meta = { car, circuit, kind: "circuit", mp: true, setup };
  setHudLabels(true);
  sound.unlock();
  sound.startRace(engineKind(car, setup));
  lastHits = 0;
  mode = "race";
  show(null);
  $("raceUi").hidden = false;
  $("hint").hidden = true;
  clearInput();
}
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
  preRace(ch ? `Campionato · tappa ${ch.champ.stage + 1} di 5` : c.name,
    `${c.name}, ${c.laps} giri, contro 5 piloti. Con ${car.name}.`);
}
async function finishCircuit(st) {
  showVmax(st.maxKmh);
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
  const r = await api.submitCircuit(token, circuit.id, car.id, st.position, Math.round(st.time * 10) / 10, Math.round(st.best * 10) / 10, kmh1(st.maxKmh));
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
  const r = await api.champStage(token, ch.id, st.position, Math.round(st.time * 10) / 10, Math.round(st.best * 10) / 10, champOrder(st.order, st.position), false, kmh1(st.maxKmh));
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
  preRace(`Pista infinita · ${track.name}`, `Con ${car.name}. Tieni premuto gas per partire.`);
}
// before every race: pick how to steer (and full screen), then go
function preRace(title, sub) {
  mode = "pre";
  clearInput();
  $("raceUi").hidden = true;
  $("preTitle").textContent = title;
  $("preSub").textContent = sub;
  $("scrPre").insertBefore($("ctrlBlock"), $("scrPre").querySelector(".actions"));
  renderCtrl(); renderFs();
  show("scrPre");
  $("preGo").focus({ preventScroll: true });
}
const sound = new Sound();
// engine character of every rival, computed once per car
function engineVoices(a) {
  for (const o of a.others) {
    if (!o.id.sndKind) o.id.sndKind = o.carId ? engineKind(carById(o.carId), o.setup) : { cyl: 4, pitch: 0.9, sub: 0.35, q: 3, bright: 0.6 };
    o.kind = o.id.sndKind;
  }
  return a;
}
function renderSnd() {
  for (const id of ["sndBtn", "sndBtn2"]) { const b = $(id); if (b) b.textContent = sound.on ? "Audio: sì" : "Audio: no"; }
}
for (const id of ["sndBtn", "sndBtn2"]) $(id).addEventListener("click", () => {
  sound.setOn(!sound.on); renderSnd();
  if (sound.on && race && (mode === "race" || mode === "paused")) sound.startRace(engineKind(race.meta.car, cfgFor(race.meta.car)));
  if (mode === "paused") sound.pause(true);
});
renderSnd();
let lastHits = 0;
function goRace() {
  if (!race || mode !== "pre") return;
  // audio may only start from a tap: this is the tap
  sound.unlock();
  sound.startRace(engineKind(race.meta.car, cfgFor(race.meta.car)));
  lastHits = 0;
  mode = "race";
  show(null);
  $("raceUi").hidden = false;
  $("hint").hidden = race.meta.kind !== "endless";
  if (race.meta.kind === "circuit" && race.begin) race.begin();
  clearInput();
}
$("preGo").addEventListener("click", goRace);
$("preBack").addEventListener("click", () => { const circ = race && race.meta.kind === "circuit"; endRace(); if (circ) openCircuits(); else goHome(); });
function endRace() {
  sound.stopAll();
  if (race) { race.dispose(); race = null; }
  $("raceUi").hidden = true;
  clearInput();
}
async function finishRun(st) {
  showVmax(st.maxKmh);
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
  const r = await api.submitRun(token, track.id, car.id, st.distance, Math.round(st.time * 10) / 10, st.cps, st.coins, kmh1(st.maxKmh));
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
let mpMenu = false;
function pause() {
  if (mode !== "race") return;
  if (race && race.meta.mp) {   // an online race cannot be stopped: the menu opens over it
    mpMenu = true; clearInput();
    $("pauseNote").hidden = false; $("pauseNote").textContent = "La gara online non si ferma. «Torna al box» chiude la sfida per tutti.";
    show("scrPause"); return;
  }
  mode = "paused"; clearInput(); sound.pause(true);
  $("pauseNote").textContent = "Se esci ora la tappa conta come ritiro: 0 punti e tempo di penalità.";
  $("pauseNote").hidden = !(race && race.meta.champ && race.state !== "finished");
  show("scrPause"); $("resume").focus({ preventScroll: true });
}
function resume() {
  if (mpMenu) { mpMenu = false; show(null); return; }
  if (mode !== "paused") return; show(null); mode = "race"; sound.pause(false);
}
$("pauseBtn").addEventListener("click", pause);
$("resume").addEventListener("click", resume);
$("quit").addEventListener("click", async () => {
  if (mpMenu || (race && race.meta.mp)) { mpMenu = false; await online.exit(); return; }
  const retire = race && race.meta.champ && race.state !== "finished";
  if (retire) { await retireChampStage(); endRace(); openCircuits(); return; }
  goHome();
});
$("again").addEventListener("click", () => {
  if (!token) { showLogin(ERRORS.no_session); return; }
  if (race && race.meta.champ) { if (champ && champ.done) newChamp(); else startChampStage(); return; }
  if (race && race.meta.kind === "circuit") startCircuit(race.meta.circuit); else startRace();
});
$("toBox").addEventListener("click", () => {
  if (!token) { showLogin(ERRORS.no_session); return; }
  if (online.inChallenge()) { online.exit(); return; }   // "Esci dalla sfida": ends it for everybody
  goHome();
});
document.addEventListener("visibilitychange", () => { if (document.hidden && !(race && race.meta.mp)) pause(); });

// ------------------------------------------------------------------ HUD
const el = { coins: $("cCoins"), spd: $("spd"), dst: $("dst"), tim: $("tim"), gT: $("gtime"), gS: $("gspd"), cp: $("cpLeft"), turbo: $("cTurbo"), shield: $("cShield"), oil: $("cOil"), off: $("cOff") };
let toastTimer = 0;
// restart the toast animation without forcing a synchronous layout (that caused a hitch at every toast)
let toastAnim = null;
const TOAST_KF = [
  { opacity: 0, transform: "translate(-50%, -30%) scale(0.85)", offset: 0 },
  { opacity: 1, transform: "translate(-50%, -50%) scale(1.04)", offset: 0.12 },
  { opacity: 1, transform: "translate(-50%, -56%) scale(1)", offset: 0.7 },
  { opacity: 0, transform: "translate(-50%, -66%) scale(1)", offset: 1 }];
function toast(text, kind) {
  const t = $("toast");
  t.textContent = text; t.className = "toast " + (kind || "");
  if (toastAnim) toastAnim.cancel();
  if (t.animate) toastAnim = t.animate(TOAST_KF, { duration: 1100, easing: "ease-out", fill: "forwards" });
  else { t.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = 0; }, 1100); }
}
const SEV_LABEL = ["veloce", "media", "stretta"];
function updateCorner(h) {
  const chip = $("cornerChip"), c = h.corner;
  const show = c && c.dist > 0 && c.dist <= 170 && h.state !== "over" && h.state !== "finished";
  hide(chip, !show);
  if (!show) return;
  const d = c.dist > 125 ? "150 m" : c.dist > 75 ? "100 m" : c.dist > 35 ? "50 m" : "ora";
  put(chip, `${c.dir > 0 ? "→" : "←"} ${c.dir > 0 ? "Destra" : "Sinistra"} ${SEV_LABEL[c.sev]} · ${d}`);
  const cls = "chip corner sev" + c.sev; if (chip._cls !== cls) { chip._cls = cls; chip.className = cls; }
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
// HUD writes only what changed: rewriting the same text every frame makes the browser re-layout the page
// 60 times a second, which on phones shows up as stutter
function put(node, v) { v = String(v); if (node._v !== v) { node._v = v; node.textContent = v; } }
function hide(node, h) { if (node._h !== h) { node._h = h; node.hidden = h; } }
function flag(node, cls, on) { const k = "_c" + cls; if (node[k] !== on) { node[k] = on; node.classList.toggle(cls, on); } }
function updateHud() {
  const h = race.hud();
  updateCorner(h);
  drawMinimap();
  if (h.circuit) {
    put(el.spd, h.kmh);
    put(el.dst, `${h.pos}°`); put($("emDist"), `/${h.total}`);
    put(el.tim, `${h.lap}`); put($("emTime"), `/${h.laps}`);
    put($("lapChip"), `Giro ${fmtLap(h.lapTime)} · Migliore ${fmtLap(h.best)}`);
    flag(el.gT, "low", false); flag(el.gS, "turbo", !!h.nosOn);
    hide(el.turbo, true); hide(el.off, !h.off);
    hide(el.shield, !(h.shield > 0)); hide(el.oil, !h.slip);
    if (h.shield > 0) put(el.shield, h.shield > 1 ? `Scudo ×${h.shield}` : "Scudo");
    const nb = $("bNos");
    hide(nb, !h.items);
    if (h.items) { put($("nosN"), h.nos); flag(nb, "empty", !(h.nos > 0) && !h.nosOn); flag(nb, "boosting", !!h.nosOn); }
    return;
  }
  put($("emDist"), "m"); put($("emTime"), "s");
  put(el.coins, fmtC(h.coins));
  put(el.spd, h.kmh); put(el.dst, h.dist); put(el.tim, h.time.toFixed(1)); put(el.cp, h.toCp);
  flag(el.gT, "low", h.state === "run" && h.time < 5);
  flag(el.gS, "turbo", h.turbo > 0);
  hide(el.turbo, !(h.turbo > 0)); if (h.turbo > 0) put(el.turbo, "Turbo " + h.turbo.toFixed(1));
  hide(el.shield, !(h.shield > 0)); hide(el.oil, !h.slip); hide(el.off, !h.off);
  if (h.shield > 0) put(el.shield, h.shield > 1 ? `Scudo ×${h.shield}` : "Scudo");
}

// ------------------------------------------------------------------ input
function clearInput() { input.gas = input.brake = input.left = input.right = false; document.querySelectorAll(".btn.on").forEach((b) => b.classList.remove("on")); }
const keyMap = { ArrowUp: "gas", KeyW: "gas", Space: "gas", ArrowDown: "brake", KeyS: "brake", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT")) return;
  if (e.code === "KeyP" || e.code === "Escape") { if (mode === "paused") resume(); else pause(); return; }
  if (e.code === "KeyN" || e.code === "Space") { input.nos = true; e.preventDefault(); return; }
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
// NOS fires once per press (the race clears the request after using it)
$("bNos").addEventListener("pointerdown", (e) => { e.preventDefault(); input.nos = true; });
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

// ------------------------------------------------------------------ online challenges
const NO_INPUT = { gas: false, brake: false, left: false, right: false, tilt: null };
for (const c of CIRCUITS) { const o = document.createElement("option"); o.value = c.id; o.textContent = `${c.name} · ${c.laps} giri`; $("roomCircuit").appendChild(o); }
const online = initOnline({
  api, ERRORS, token: () => token, profile: () => profile, setProfile, toast, show, goHome, startMpRace,
  endRace: () => endRace(), endRaceKeepRoom: () => { endRace(); mode = "menu"; }, race: () => race,
  isRacing: () => !!race && (mode === "race" || mode === "paused" || mode === "pre"),
  fmtLap, fmtC, renderCtrl, ctrlBlock: () => $("ctrlBlock"), carById, setupText, renderBoard,
  showCar: (car, cfg) => showroom.setCar(car, cleanConfig(car, cfg), false),
  duck: (on) => sound.duck(on)
});
$("goChallenge").addEventListener("click", () => online.openLobbyRoom());
// browsers allow sound only after a tap: any tap unlocks it (guests start races without tapping "Via")
addEventListener("pointerdown", () => sound.unlock(), { once: true });

// ------------------------------------------------------------------ loop
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (race && (mode === "race" || mode === "over")) {
    showroom.active = false;
    // as many equal sub-steps (each at most 1/60 s) as this frame needs: the car moves the same amount
    // every frame, so 90/120 Hz screens don't alternate between 0 and 2 physics steps (judder)
    input.tilt = tiltSteer();
    const n = Math.max(1, Math.ceil(dt / STEP - 0.05)), h = dt / n;
    const inp = mpMenu ? NO_INPUT : input;
    for (let i = 0; i < n; i++) race.update(h, inp);
    input.nos = false;
    if (race.mp) online.tick(race, dt);
    if (!race) { requestAnimationFrame(frame); return; }   // the online results just closed the race
    if (mode === "race" && race.audioState) {
      sound.update(engineVoices(race.audioState(input)));
      const hits = race.contacts ?? race.crashes ?? 0;
      if (hits > lastHits) sound.bump(6);
      lastHits = hits;
    }
    race.render(dt, now);
    updateHud();
  } else if (race && (mode === "paused" || mode === "pre")) {
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
    if (r.profile) { setProfile(r.profile); goHome(); online.start(); return; }
    if (r.error === "network") { showLogin(ERRORS.network); return; }
    store.del("faro-token"); token = null;
  }
  showLogin();
}
boot();

// hook for automated checks only
window.__faroSound = sound;
window.__faro = {
  get mode() { return mode; }, input,
  get race() { return race; },
  fakeLogin(p) { token = "test"; setProfile(p); goHome(); online.start(); },
  online: () => online,
  startRace, openGarage, openTracks, startCircuit: (id) => startCircuit(circuitById(id))
};
