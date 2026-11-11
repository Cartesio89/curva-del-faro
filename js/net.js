// Real-time link between players: who is online (presence) and the messages of a challenge room (broadcast).
// Two interchangeable transports with the same small interface:
//  - Supabase Realtime (the real one, over the internet)
//  - BroadcastChannel (only between tabs of the same browser: used by the automated tests)
import { SUPABASE_URL, SUPABASE_KEY } from "./api.js";

let sbClient = null;
function loadSupabase() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "vendor/supabase-2.117.3.umd.js";
    s.onload = () => res(window.supabase);
    s.onerror = () => rej(new Error("realtime_load"));
    document.head.appendChild(s);
  });
}

// ---- channel over Supabase Realtime
class SbChannel {
  constructor(client, name, key) {
    this.handlers = new Map(); this.presenceCb = null; this.key = key; this.meta = null; this.ready = false;
    this.ch = client.channel(name, { config: { broadcast: { self: false }, presence: { key } } });
    this.ch.on("broadcast", { event: "m" }, ({ payload }) => { const f = this.handlers.get(payload.t); if (f) f(payload); });
    this.ch.on("presence", { event: "sync" }, () => this.emitPresence());
  }
  emitPresence() {
    if (!this.presenceCb) return;
    const st = this.ch.presenceState(), list = [];
    for (const k of Object.keys(st)) { const m = st[k][st[k].length - 1]; if (m) list.push({ ...m, key: k }); }
    this.presenceCb(list);
  }
  subscribe() {
    return new Promise((res) => {
      this.ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") { this.ready = true; if (this.meta) await this.ch.track(this.meta); res(true); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") res(false);
      });
    });
  }
  on(type, fn) { this.handlers.set(type, fn); }
  onPresence(fn) { this.presenceCb = fn; }
  send(type, data) { if (this.ready) this.ch.send({ type: "broadcast", event: "m", payload: { t: type, ...data } }); }
  track(meta) { this.meta = meta; if (this.ready) this.ch.track(meta); }
  close() { try { sbClient && sbClient.removeChannel(this.ch); } catch (_) {} }
}

// ---- channel between tabs of the same browser (tests)
class LocalChannel {
  constructor(name, key) {
    this.bc = new BroadcastChannel("faro-" + name); this.key = key; this.handlers = new Map();
    this.peers = new Map(); this.meta = null; this.presenceCb = null;
    this.bc.onmessage = (e) => {
      const m = e.data;
      if (m.__p) { if (m.left) this.peers.delete(m.key); else this.peers.set(m.key, { meta: m.meta, seen: Date.now() }); this.emitPresence(); return; }
      const f = this.handlers.get(m.t); if (f) f(m);
    };
    this.timer = setInterval(() => {
      if (this.meta) this.bc.postMessage({ __p: 1, key: this.key, meta: this.meta });
      const now = Date.now(); let gone = false;
      for (const [k, p] of this.peers) if (now - p.seen > 4000) { this.peers.delete(k); gone = true; }
      if (gone) this.emitPresence();
    }, 1000);
  }
  emitPresence() {
    if (!this.presenceCb) return;
    const list = [...this.peers].map(([k, p]) => ({ ...p.meta, key: k }));
    if (this.meta) list.push({ ...this.meta, key: this.key });
    this.presenceCb(list);
  }
  subscribe() { if (this.meta) this.bc.postMessage({ __p: 1, key: this.key, meta: this.meta }); return Promise.resolve(true); }
  on(type, fn) { this.handlers.set(type, fn); }
  onPresence(fn) { this.presenceCb = fn; }
  send(type, data) { this.bc.postMessage({ t: type, ...data }); }
  track(meta) { this.meta = meta; this.bc.postMessage({ __p: 1, key: this.key, meta }); this.emitPresence(); }
  close() { try { this.bc.postMessage({ __p: 1, key: this.key, left: 1 }); } catch (_) {} clearInterval(this.timer); this.bc.close(); }
}

export const netLocal = new URLSearchParams(location.search).get("net") === "local";

export async function openChannel(name, key) {
  if (netLocal) return new LocalChannel(name, key);
  const lib = await loadSupabase();
  if (!sbClient) sbClient = lib.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 30 } }
  });
  return new SbChannel(sbClient, name, key);
}
