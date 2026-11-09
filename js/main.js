import * as THREE from "three";
import {
  CARS, TRACKS, PARTS, PART_ORDER, COLORS, carById, trackById, cleanConfig, performance as perfOf,
  carUnlocked, trackUnlocked, unlockText
} from "./data.js";
import { api, ERRORS } from "./api.js";
import { Race } from "./race.js";
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

const cfgFor = (car) => cleanConfig(car, garage.cars[car.id]);
const selCar = () => { const c = carById(garage.sel); return carUnlocked(c, profile) ? c : CARS[0]; };
const selTrack = () => { const t = trackById(garage.track); return trackUnlocked(t, profile) ? t : TRACKS[0]; };
const SCREENS = ["scrLogin", "scrHome", "scrGarage", "scrTracks", "scrBoard", "scrPause", "scrOver"];
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
  const nextCar = CARS.find((c) => !carUnlocked(c, profile));
  const nextTrack = TRACKS.find((t) => !trackUnlocked(t, profile));
  const bits = [];
  if (nextCar) bits.push(`Prossima auto, ${nextCar.name}: ${unlockText(nextCar)}.`);
  if (nextTrack) bits.push(`Prossima pista, ${nextTrack.name}: ${unlockText(nextTrack)}.`);
  $("homeNext").textContent = bits.join(" ");
  show("scrHome");
}
$("goRace").addEventListener("click", () => startRace());
$("goGarage").addEventListener("click", () => openGarage());
$("goTracks").addEventListener("click", () => openTracks());
$("goBoard").addEventListener("click", () => openBoard(selTrack().id));
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
function statBar(label, value, frac, text) {
  const row = document.createElement("div"); row.className = "bar";
  const a = document.createElement("span"); a.textContent = label;
  const t = document.createElement("span"); t.className = "track-bar";
  const f = document.createElement("span"); f.className = "fill"; f.style.width = Math.round(Math.max(0.04, Math.min(1, frac)) * 100) + "%"; f.style.display = "block";
  t.appendChild(f);
  const b = document.createElement("b"); b.textContent = text;
  row.append(a, t, b);
  return row;
}
function renderGarage(rebuildModel) {
  const car = CARS[garageIdx];
  const locked = !carUnlocked(car, profile);
  const cfg = cfgFor(car);
  if (rebuildModel) showroom.setCar(car, cfg, locked);
  $("gName").textContent = car.name;
  $("gKind").textContent = `${garageIdx + 1}/10 · ${car.kind}`;
  const lock = $("gLock");
  lock.hidden = !locked;
  lock.textContent = locked ? `Bloccata: ${unlockText(car)}.` : "";
  const p = perfOf(car, cfg);
  const st = $("gStats"); st.textContent = "";
  st.append(
    statBar("Velocità", p.topKmh, (p.topKmh - 150) / 260, Math.round(p.topKmh) + " km/h"),
    statBar("0-100", p.acc0100, (13 - p.acc0100) / 11, p.acc0100.toFixed(1).replace(".", ",") + " s"),
    statBar("Tenuta", p.grip, (p.grip - 8) / 14, (p.grip / 9.81).toFixed(2).replace(".", ",") + " g")
  );
  const parts = $("gParts"); parts.textContent = "";
  for (const key of PART_ORDER) {
    const part = PARTS[key];
    const box = document.createElement("div"); box.className = "part";
    const lab = document.createElement("small"); lab.textContent = part.label;
    const opts = document.createElement("div"); opts.className = "opts";
    for (const o of part.options) {
      const b = document.createElement("button");
      b.className = "opt" + (cfg[key] === o.id ? " on" : "");
      b.textContent = o.label; b.disabled = locked;
      b.addEventListener("click", () => { setPart(car, key, o.id); });
      opts.appendChild(b);
    }
    box.append(lab, opts); parts.appendChild(box);
  }
  const cbox = document.createElement("div"); cbox.className = "part";
  const clab = document.createElement("small"); clab.textContent = "Colore";
  const sws = document.createElement("div"); sws.className = "swatches";
  for (const c of COLORS) {
    const b = document.createElement("button");
    b.className = "sw" + (cfg.color === c ? " on" : ""); b.style.background = c; b.disabled = locked;
    b.setAttribute("aria-label", "Colore " + c);
    b.addEventListener("click", () => setPart(car, "color", c));
    sws.appendChild(b);
  }
  cbox.append(clab, sws); parts.appendChild(cbox);
  const use = $("gUse");
  if (locked) { use.textContent = "Bloccata"; use.disabled = true; }
  else if (garage.sel === car.id) { use.textContent = "In uso"; use.disabled = true; }
  else { use.textContent = "Usa questa auto"; use.disabled = false; }
}
function setPart(car, key, value) {
  const cfg = { ...cfgFor(car), [key]: value };
  garage.cars[car.id] = cfg;
  scheduleSave();
  renderGarage(true);
}
$("carPrev").addEventListener("click", () => { garageIdx = (garageIdx + CARS.length - 1) % CARS.length; renderGarage(true); });
$("carNext").addEventListener("click", () => { garageIdx = (garageIdx + 1) % CARS.length; renderGarage(true); });
$("gUse").addEventListener("click", () => { garage.sel = CARS[garageIdx].id; scheduleSave(); renderGarage(false); });
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
function renderBoard(ol, rows, highlightName) {
  ol.textContent = "";
  const li0 = (text) => { const li = document.createElement("li"); li.className = "empty"; li.textContent = text; ol.appendChild(li); };
  if (!Array.isArray(rows)) return li0("Classifica non raggiungibile in questo momento.");
  if (!rows.length) return li0("Ancora nessun tempo su questa pista. Il primo posto è libero.");
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (highlightName && r.name.toLowerCase() === highlightName.toLowerCase()) li.className = "me";
    const pos = document.createElement("span"); pos.className = "pos"; pos.textContent = i + 1;
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = r.name;
    const car = document.createElement("small"); car.textContent = carById(r.car).name; nm.appendChild(car);
    const m = document.createElement("span"); m.className = "m"; m.textContent = fmtM(r.distance_m);
    const t = document.createElement("span"); t.className = "t"; t.textContent = Math.round(r.time_s) + " s";
    li.append(pos, nm, m, t); ol.appendChild(li);
  });
}
async function openBoard(trackId) {
  const tabs = $("boardTabs"); tabs.textContent = "";
  for (const t of TRACKS) {
    const b = document.createElement("button");
    b.className = "tab" + (t.id === trackId ? " on" : ""); b.textContent = t.name; b.setAttribute("role", "tab");
    b.addEventListener("click", () => openBoard(t.id));
    tabs.appendChild(b);
  }
  show("scrBoard");
  const ol = $("boardList");
  ol.innerHTML = '<li class="empty">Carico…</li>';
  renderBoard(ol, await api.top(trackId), profile && profile.name);
}
$("bBack").addEventListener("click", goHome);

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
  race.meta = { car, track };
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
  $("oDist").textContent = st.distance.toLocaleString("it-IT");
  $("oTime").textContent = Math.round(st.time) + " s";
  $("oCp").textContent = st.cps; $("oNear").textContent = st.near; $("oHit").textContent = st.crashes;
  $("oUnlocks").textContent = "";
  $("oBoardTitle").textContent = `Top 10 · ${track.name}`;
  $("oBoard").innerHTML = "";
  show("scrOver");
  $("again").focus({ preventScroll: true });
  const save = $("oSave");
  if (st.distance < 1 || st.time < 1) { save.textContent = ""; return; }
  save.textContent = "Salvo la partita…";
  const r = await api.submitRun(token, track.id, car.id, st.distance, Math.round(st.time * 10) / 10, st.cps);
  if (r && r.profile) {
    const prevBest = (profile.best && profile.best[track.id] && profile.best[track.id].best_m) || 0;
    setProfile(r.profile, true);
    if (st.distance > prevBest) $("oTitle").textContent = "Nuovo record su questa pista!";
    save.textContent = `Salvata: sei ${r.rank}° su ${track.name}.`;
    const box = $("oUnlocks");
    for (const c of CARS) if (!before.cars.includes(c.id) && carUnlocked(c, profile)) { const d = document.createElement("div"); d.textContent = `Nuova auto sbloccata: ${c.name}`; box.appendChild(d); }
    for (const t of TRACKS) if (!before.tracks.includes(t.id) && trackUnlocked(t, profile)) { const d = document.createElement("div"); d.textContent = `Nuova pista sbloccata: ${t.name}`; box.appendChild(d); }
  } else {
    save.textContent = ERRORS[r && r.error] || "Partita non salvata.";
    if (r && r.error === "no_session") { token = null; store.del("faro-token"); }
  }
  renderBoard($("oBoard"), await api.top(track.id), profile && profile.name);
}
function pause() { if (mode !== "race") return; mode = "paused"; clearInput(); show("scrPause"); $("resume").focus({ preventScroll: true }); }
function resume() { if (mode !== "paused") return; show(null); mode = "race"; }
$("pauseBtn").addEventListener("click", pause);
$("resume").addEventListener("click", resume);
$("quit").addEventListener("click", goHome);
$("again").addEventListener("click", () => { if (!token) { showLogin(ERRORS.no_session); return; } startRace(); });
$("toBox").addEventListener("click", () => { if (!token) { showLogin(ERRORS.no_session); return; } goHome(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

// ------------------------------------------------------------------ HUD
const el = { spd: $("spd"), dst: $("dst"), tim: $("tim"), gT: $("gtime"), gS: $("gspd"), cp: $("cpLeft"), turbo: $("cTurbo"), shield: $("cShield"), oil: $("cOil"), off: $("cOff") };
let toastTimer = 0;
function toast(text, kind) {
  const t = $("toast");
  t.textContent = text; t.className = "toast"; void t.offsetWidth; t.className = "toast show " + (kind || "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = "toast"; }, 1200);
}
function updateHud() {
  const h = race.hud();
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
  startRace, openGarage, openTracks
};
