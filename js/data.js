// Cars, parts, tracks and unlock rules. Everything here is plain data + pure functions,
// so it survives any change of graphics.

export const LANE_W = 3.6;
export const LANES = 3;
export const ROAD_HALF = (LANE_W * LANES) / 2; // 5.4 m

export const START_TIME = 28;
export const CP_FIRST = 600;
export const CP_GAP = 1200;
export const START_S = 60; // the car starts a bit down the road so there is tarmac behind the camera

// ---------------------------------------------------------------- cars
// top: km/h, acc: 0-100 km/h in seconds, grip: lateral grip in m/s², mass: crash resistance 0..1
// shape: body proportions used by the 3D builder (metres)
export const CARS = [
  { id: "lucciola", name: "Lucciola", kind: "Citycar", top: 185, acc: 11.0, grip: 10.5, mass: 0.35,
    unlock: { km: 0, cp: 0 },
    shape: { type: "hatch", L: 3.6, W: 1.64, H: 1.5, belt: 0.95, clr: 0.16, nose: 0.78, cabin: [0.27, 0.9], ws: 0.17, wheel: 0.3 } },
  { id: "gabbiano", name: "Gabbiano", kind: "Hatchback sportiva", top: 210, acc: 8.5, grip: 11.5, mass: 0.45,
    unlock: { km: 5, cp: 3 },
    shape: { type: "hatch", L: 4.05, W: 1.76, H: 1.44, belt: 0.92, clr: 0.14, nose: 0.74, cabin: [0.3, 0.88], ws: 0.2, wheel: 0.32 } },
  { id: "delfino", name: "Delfino", kind: "Berlina", top: 225, acc: 7.6, grip: 11.5, mass: 0.6,
    unlock: { km: 12, cp: 4 },
    shape: { type: "notch", L: 4.7, W: 1.82, H: 1.45, belt: 0.92, clr: 0.15, nose: 0.76, cabin: [0.31, 0.76], ws: 0.2, wheel: 0.33 } },
  { id: "medusa", name: "Medusa", kind: "Spider", top: 230, acc: 6.8, grip: 13, mass: 0.4,
    unlock: { km: 25, cp: 5 },
    shape: { type: "roadster", L: 4.0, W: 1.75, H: 1.22, belt: 0.86, clr: 0.13, nose: 0.66, cabin: [0.42, 0.66], ws: 0.14, wheel: 0.32 } },
  { id: "cormorano", name: "Cormorano", kind: "Rally", top: 220, acc: 5.9, grip: 14, mass: 0.55,
    unlock: { km: 40, cp: 6 },
    shape: { type: "hatch", L: 4.1, W: 1.82, H: 1.5, belt: 0.98, clr: 0.24, nose: 0.8, cabin: [0.3, 0.88], ws: 0.2, wheel: 0.34 } },
  { id: "squalo", name: "Squalo", kind: "Muscle car", top: 260, acc: 5.0, grip: 11.5, mass: 0.8,
    unlock: { km: 60, cp: 7 },
    shape: { type: "fastback", L: 4.85, W: 1.92, H: 1.36, belt: 0.9, clr: 0.14, nose: 0.82, cabin: [0.42, 0.92], ws: 0.17, wheel: 0.35 } },
  { id: "falco", name: "Falco", kind: "Gran turismo", top: 280, acc: 4.4, grip: 13.5, mass: 0.65,
    unlock: { km: 90, cp: 8 },
    shape: { type: "fastback", L: 4.6, W: 1.9, H: 1.3, belt: 0.84, clr: 0.12, nose: 0.66, cabin: [0.38, 0.9], ws: 0.22, wheel: 0.35 } },
  { id: "orca", name: "Orca", kind: "Supercar", top: 300, acc: 3.6, grip: 15, mass: 0.6,
    unlock: { km: 130, cp: 9 },
    shape: { type: "wedge", L: 4.5, W: 1.98, H: 1.16, belt: 0.74, clr: 0.11, nose: 0.42, cabin: [0.3, 0.72], ws: 0.25, wheel: 0.35 } },
  { id: "fulmine", name: "Fulmine", kind: "Hypercar", top: 330, acc: 2.9, grip: 16, mass: 0.6,
    unlock: { km: 180, cp: 11 },
    shape: { type: "wedge", L: 4.65, W: 2.02, H: 1.1, belt: 0.7, clr: 0.1, nose: 0.36, cabin: [0.33, 0.7], ws: 0.27, wheel: 0.36 } },
  { id: "faro", name: "Faro", kind: "Prototipo", top: 360, acc: 2.5, grip: 18, mass: 0.7,
    unlock: { km: 250, cp: 13 },
    shape: { type: "proto", L: 4.8, W: 2.0, H: 1.04, belt: 0.62, clr: 0.09, nose: 0.3, cabin: [0.36, 0.66], ws: 0.25, wheel: 0.36 } }
];
export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];

// ---------------------------------------------------------------- parts
// Each option: label + multipliers on top speed (top), acceleration (acc), grip.
export const PARTS = {
  gears: { label: "Rapporti", options: [
    { id: "corti", label: "Corti", top: 0.92, acc: 1.12 },
    { id: "std", label: "Standard" },
    { id: "lunghi", label: "Lunghi", top: 1.07, acc: 0.9 } ] },
  tyres: { label: "Gomme", options: [
    { id: "dure", label: "Dure", grip: 0.94, top: 1.03 },
    { id: "medie", label: "Medie" },
    { id: "morbide", label: "Morbide", grip: 1.1, top: 0.98 } ] },
  wing: { label: "Alettone", options: [
    { id: "nessuno", label: "Nessuno", top: 1.03, grip: 0.98 },
    { id: "basso", label: "Basso", grip: 1.05 },
    { id: "alto", label: "Alto", grip: 1.13, top: 0.96 } ] },
  kit: { label: "Carrozzeria", options: [
    { id: "stradale", label: "Stradale" },
    { id: "sport", label: "Sport", acc: 1.03, top: 1.01 },
    { id: "corsa", label: "Corsa", acc: 1.06, top: 1.02, grip: 1.02 } ] },
  rims: { label: "Cerchi", options: [
    { id: "razze", label: "5 razze" }, { id: "multi", label: "Multirazze" }, { id: "pieni", label: "Lenticolari" } ] }
};
export const PART_ORDER = ["gears", "tyres", "wing", "kit", "rims"];
export const COLORS = ["#c8352e", "#3fbfae", "#f2c14e", "#2b4fa3", "#f4f1e8", "#24212c", "#ff7a1a", "#2f9b6a", "#8e4fc2", "#9aa3ad"];

export function defaultConfig(car) {
  const i = CARS.indexOf(car);
  return { color: COLORS[i % COLORS.length], gears: "std", tyres: "medie", wing: car.shape.type === "wedge" || car.shape.type === "proto" ? "basso" : "nessuno", kit: "stradale", rims: "razze" };
}

export function cleanConfig(car, cfg) {
  const out = defaultConfig(car);
  if (cfg && typeof cfg === "object") {
    if (typeof cfg.color === "string" && COLORS.includes(cfg.color)) out.color = cfg.color;
    for (const k of PART_ORDER) if (cfg[k] && PARTS[k].options.some((o) => o.id === cfg[k])) out[k] = cfg[k];
  }
  return out;
}

// Final performance after parts. Returns SI units plus display values.
export function performance(car, cfg) {
  let top = 1, acc = 1, grip = 1;
  for (const k of PART_ORDER) {
    const o = PARTS[k].options.find((x) => x.id === cfg[k]);
    if (!o) continue;
    top *= o.top || 1; acc *= o.acc || 1; grip *= o.grip || 1;
  }
  const topKmh = car.top * top;
  const acc0100 = car.acc / acc;
  return {
    topKmh, acc0100, grip: car.grip * grip, mass: car.mass,
    topMs: topKmh / 3.6,
    a0: (100 / 3.6) / acc0100 * 1.14 // launch accel; falls off with speed (calibrated so the 0-100 shown is the real one)
  };
}

// ---------------------------------------------------------------- tracks
export const TRACKS = [
  { id: "costiera", name: "Costiera", desc: "Tramonto sul mare, curve morbide.", unlock: null,
    sky: ["#3f63a3", "#e99a5a", "#ffd79c"], fog: "#f2c79a", fogNear: 90, fogFar: 950, sun: "#ffd9a0", sunI: 2.4, hemi: ["#ffe7c4", "#4e6e35"], hemiI: 1.1,
    ground: "#6f9440", verge: "#7a9c46", road: "#6a686e", kerb: ["#f3efe4", "#c8352e"], night: false,
    curve: [0.002, 0.0085], hills: 14, traffic: 1, grip: 1, offroad: 0.55, cpExtra: 0,
    scenery: ["cypress", "pine", "post"], skyline: "sea" },
  { id: "colline", name: "Colline", desc: "Vigneti e saliscendi ripidi.", unlock: { track: "costiera", cp: 3 },
    sky: ["#5f9bd6", "#b9dcf2", "#eef6f2"], fog: "#d9ead8", fogNear: 80, fogFar: 900, sun: "#fff4dc", sunI: 2.6, hemi: ["#f2f7ff", "#5c7d33"], hemiI: 1.15,
    ground: "#7e9b3e", verge: "#8aa848", road: "#66656b", kerb: ["#f3efe4", "#2f6fb0"], night: false,
    curve: [0.003, 0.01], hills: 30, traffic: 1, grip: 1, offroad: 0.55, cpExtra: 1,
    scenery: ["vine", "cypress", "post"], skyline: "hills" },
  { id: "montagna", name: "Montagna", desc: "Neve e tornanti: poca aderenza.", unlock: { track: "colline", cp: 3 },
    sky: ["#8ea3b8", "#c9d4de", "#e6ebef"], fog: "#dfe5ea", fogNear: 60, fogFar: 650, sun: "#ffffff", sunI: 1.6, hemi: ["#f4f8ff", "#9aa6b0"], hemiI: 1.3,
    ground: "#eef2f5", verge: "#e3e9ee", road: "#5a5c62", kerb: ["#f3efe4", "#c8352e"], night: false,
    curve: [0.004, 0.0135], hills: 34, traffic: 0.8, grip: 0.78, offroad: 0.45, cpExtra: 3,
    scenery: ["snowpine", "post"], skyline: "alps" },
  { id: "canyon", name: "Canyon", desc: "Rettilinei infiniti, sabbia ai bordi.", unlock: { track: "montagna", cp: 3 },
    sky: ["#3c78c4", "#9cc6e8", "#f4dcb0"], fog: "#f0d2a6", fogNear: 120, fogFar: 1150, sun: "#fff0d0", sunI: 2.8, hemi: ["#fff3dc", "#b5653a"], hemiI: 1.1,
    ground: "#d39a5e", verge: "#dcaa6d", road: "#5e5a58", kerb: ["#f3efe4", "#b5653a"], night: false,
    curve: [0.0015, 0.0065], hills: 18, traffic: 1.1, grip: 0.97, offroad: 0.35, cpExtra: 0,
    scenery: ["rock", "cactus", "post"], skyline: "mesa" },
  { id: "citta", name: "Città di notte", desc: "Luci, palazzi e tanto traffico.", unlock: { track: "canyon", cp: 3 },
    sky: ["#0b1026", "#1d2350", "#3b2c5a"], fog: "#241f3e", fogNear: 50, fogFar: 700, sun: "#9fb2ff", sunI: 0.7, hemi: ["#6c78c8", "#1a1a24"], hemiI: 0.9,
    ground: "#2c2d33", verge: "#3a3b42", road: "#3c3c42", kerb: ["#d9d9d9", "#3a3b42"], night: true,
    curve: [0.002, 0.009], hills: 8, traffic: 1.6, grip: 0.95, offroad: 0.5, cpExtra: 1,
    scenery: ["building", "lamp"], skyline: "city" }
];
export const trackById = (id) => TRACKS.find((t) => t.id === id) || TRACKS[0];

export const cpBonus = (k, track) => Math.max(14, 26 - k) + (track.cpExtra || 0);

// ---------------------------------------------------------------- unlocks
export function bestCpAny(profile) {
  let m = 0;
  for (const k in (profile && profile.best) || {}) m = Math.max(m, profile.best[k].best_cp || 0);
  return m;
}
export function carUnlocked(car, profile) {
  if (!car.unlock.km && !car.unlock.cp) return true;
  const km = ((profile && profile.total_m) || 0) / 1000;
  return km >= car.unlock.km || bestCpAny(profile) >= car.unlock.cp;
}
export function trackUnlocked(track, profile) {
  if (!track.unlock) return true;
  const b = profile && profile.best && profile.best[track.unlock.track];
  return !!b && (b.best_cp || 0) >= track.unlock.cp;
}
export function unlockText(item) {
  if (item.unlock && "km" in item.unlock) return `${item.unlock.km} km totali oppure ${item.unlock.cp} traguardi in una partita`;
  if (item.unlock) return `${item.unlock.cp} traguardi in una partita su ${trackById(item.unlock.track).name}`;
  return "";
}
