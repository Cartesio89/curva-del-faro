// Online challenges: who is online, invitations, the waiting room on the circuit, the race between
// real players (the host also drives the AI that fill the grid up to 6), results and "what next".
import { openChannel } from "./net.js";
import { CARS, CIRCUITS, PARTS, PART_ORDER, COLORS, defaultConfig, circuitById } from "./data.js";
import { aiSpecs } from "./circuit.js";

const $ = (id) => document.getElementById(id);
const SEND_EVERY = 0.1;            // seconds between state messages (10 per second)
const LOST_AFTER = 12000;          // ms without news: that player has dropped out

export function initOnline(ctx) {
  // ctx: { api, ERRORS, token(), profile(), setProfile, toast, show, goHome, startMpRace, endRace, mode(), fmtLap, fmtC,
  //        renderCtrl, ctrlBlock, carById, setupText, renderBoard, isRacing() }
  let lobby = null, online = [], room = null, roomCh = null, host = false, raceNo = 1;
  let pendingInvite = null, pollTimer = 0, sendAcc = 0, result = null, myFinish = null, hostWatch = 0, started = false;
  const me = () => ctx.profile() && ctx.profile().name;

  // ------------------------------------------------------------- lobby: who is online
  async function start() {
    stop();
    const name = me(); if (!name) return;
    try { lobby = await openChannel("lobby", name); } catch (e) { renderOnline(); return; }
    lobby.onPresence((list) => { online = list.filter((p) => p.name); renderOnline(); });
    lobby.on("inv", (m) => { if (m.to && m.to.toLowerCase() === name.toLowerCase()) checkInvites(); });
    lobby.track({ name, busy: false });
    pollTimer = setInterval(checkInvites, 20000);
    checkInvites();
    if (!(await lobby.subscribe())) {
      // no live link (network or service): invitations still arrive by polling; retry the link later
      lobby.close(); lobby = null; renderOnline();
      retryTimer = setTimeout(() => { if (me() && !lobby) start(); }, 30000);
    }
  }
  let retryTimer = 0;
  function stop() {
    clearInterval(pollTimer); clearTimeout(retryTimer);
    if (lobby) { lobby.close(); lobby = null; }
    online = []; renderOnline();
  }
  function setBusy(b) { if (lobby && me()) lobby.track({ name: me(), busy: b }); }

  function renderOnline() {
    for (const [listId, inRoom] of [["onlineList", false], ["roomOnline", true]]) {
      const ul = $(listId); if (!ul) continue;
      ul.textContent = "";
      const others = online.filter((p) => p.name !== me());
      if (!others.length) {
        const li = document.createElement("li"); li.className = "empty";
        li.textContent = lobby ? "Nessun altro pilota online in questo momento." : "Collegamento online non disponibile.";
        ul.appendChild(li);
      }
      for (const p of others) {
        const li = document.createElement("li");
        const nm = document.createElement("span"); nm.textContent = p.name;
        li.appendChild(nm);
        const already = room && room.members && room.members.some((m) => m.name === p.name && (m.state === "joined" || m.state === "invited"));
        if (p.busy && !already) { const b = document.createElement("small"); b.textContent = "in sfida"; li.appendChild(b); }
        else if (inRoom && already) { const b = document.createElement("small"); b.textContent = "invitato"; li.appendChild(b); }
        else if (!inRoom || host) {
          const b = document.createElement("button"); b.className = "go small"; b.textContent = "Sfida";
          b.addEventListener("click", () => challenge(p.name));
          li.appendChild(b);
        }
        ul.appendChild(li);
      }
    }
    const n = $("onlineCount"); if (n) n.textContent = String(Math.max(0, online.filter((p) => p.name !== me()).length));
  }

  // ------------------------------------------------------------- invitations
  async function checkInvites() {
    if (!ctx.token() || room) return;
    const r = await ctx.api.invitesPending(ctx.token());
    const inv = r && r.invites && r.invites[0];
    if (!inv) { hideInvite(); return; }
    pendingInvite = inv;
    const c = circuitById(inv.circuit);
    $("inviteText").textContent = `${inv.host} ti sfida su ${c ? c.name : inv.circuit}`;
    $("inviteBar").hidden = false;
  }
  function hideInvite() { $("inviteBar").hidden = true; pendingInvite = null; }
  $("invYes").addEventListener("click", async () => {
    const inv = pendingInvite; hideInvite();
    if (!inv) return;
    if (ctx.isRacing()) ctx.endRace();
    const r = await ctx.api.roomRespond(ctx.token(), inv.id, true);
    if (!r || !r.room) { ctx.toast(ctx.ERRORS[r && r.error] || "Sfida non disponibile.", "bad"); return; }
    host = false;
    await enterRoom(r.room);
  });
  $("invNo").addEventListener("click", async () => {
    const inv = pendingInvite; hideInvite();
    if (inv) await ctx.api.roomRespond(ctx.token(), inv.id, false);
  });

  // ------------------------------------------------------------- the room (waiting room on the circuit)
  function randomCarSetup() {
    const car = CARS[Math.floor(Math.random() * CARS.length)];
    const cfg = { ...defaultConfig(car), color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    for (const k of PART_ORDER) { const o = PARTS[k].options; cfg[k] = o[Math.floor(Math.random() * o.length)].id; }
    return { car: car.id, setup: cfg };
  }
  async function challenge(name) {
    if (!room) {
      const pick = randomCarSetup();
      const r = await ctx.api.roomCreate(ctx.token(), $("roomCircuit").value || CIRCUITS[0].id, pick.car, pick.setup);
      if (!r || !r.room) { ctx.toast(ctx.ERRORS[r && r.error] || "Sfida non creata.", "bad"); return; }
      host = true;
      await enterRoom(r.room);
    }
    const r2 = await ctx.api.roomInvite(ctx.token(), room.id, name);
    if (!r2 || !r2.room) { ctx.toast(ctx.ERRORS[r2 && r2.error] || "Invito non inviato.", "bad"); return; }
    room = r2.room; renderRoom();
    if (lobby) lobby.send("inv", { to: name, room: room.id, from: me() });
    ctx.toast(`Invito mandato a ${name}`, "good");
    if (roomCh) roomCh.send("roster", {});
  }
  async function enterRoom(r) {
    room = r; raceNo = r.race_no; started = false;
    setBusy(true);
    if (roomCh) roomCh.close();
    try { roomCh = await openChannel("room-" + r.id, me()); }
    catch (e) { ctx.toast("Collegamento online non disponibile.", "bad"); return; }
    roomCh.onPresence((list) => { room.here = list.map((p) => p.name); renderRoom(); });
    roomCh.on("roster", refreshRoom);
    roomCh.on("circuit", (m) => { room.circuit = m.circuit; Object.assign(room, m.car ? { car: m.car, setup: m.setup } : {}); renderRoom(); });
    roomCh.on("start", (m) => beginRace(m));
    roomCh.on("st", (m) => onState(m));
    roomCh.on("result", (m) => onResult(m));
    roomCh.on("next", (m) => onNext(m));
    roomCh.on("exit", (m) => closed(`${m.by} ha chiuso la sfida.`));
    roomCh.track({ name: me() });
    if (!(await roomCh.subscribe())) ctx.toast("Collegamento in tempo reale non riuscito: riprova tra poco.", "bad");
    roomCh.send("roster", {});
    showRoom();
  }
  async function refreshRoom() {
    if (!room) return;
    const r = await ctx.api.roomGet(ctx.token(), room.id);
    if (r && r.room) {
      const here = room.here;
      room = { ...r.room, here };
      if (r.room.status === "closed" && !result) { closed("La sfida è stata chiusa."); return; }
      renderRoom();
    }
  }
  function showRoom() {
    ctx.show("scrRoom");
    $("roomBox").appendChild(ctx.ctrlBlock());     // steering choice lives here before an online race
    ctx.renderCtrl();
    renderRoom();
  }
  function renderRoom() {
    if (!room) return;
    const c = circuitById(room.circuit), car = ctx.carById(room.car);
    $("roomTitle").textContent = `Sfida · ${c ? c.name : room.circuit}`;
    const parts = ctx.setupText(room.setup).replace(/^ · /, "");
    $("roomSub").textContent = `Gara ${raceNo} · ${c ? c.laps : 3} giri. Auto uguale per tutti i giocatori: ${car.name}${parts ? " (" + parts + ")" : ", di serie"}.`;
    if (room.shownCar !== room.car + JSON.stringify(room.setup)) { room.shownCar = room.car + JSON.stringify(room.setup); ctx.showCar(car, room.setup); }
    const sel = $("roomCircuit");
    sel.disabled = !host || started;
    if (sel.value !== room.circuit) sel.value = room.circuit;
    const ul = $("roomPlayers"); ul.textContent = "";
    const here = new Set(room.here || []);
    const humans = humansHere();
    for (const m of room.members || []) {
      if (m.state === "left") continue;
      const li = document.createElement("li");
      const nm = document.createElement("span"); nm.textContent = m.name + (m.name === room.host ? " (organizza)" : "");
      const st = document.createElement("small");
      st.textContent = m.state === "declined" ? "ha rifiutato" : here.has(m.name) ? "pronto" : m.state === "invited" ? "invitato…" : "non collegato";
      li.append(nm, st); ul.appendChild(li);
    }
    $("roomAi").textContent = `Posti IA: ${6 - humans.length} · in griglia ${humans.length} ${humans.length === 1 ? "giocatore" : "giocatori"}.`;
    $("roomGo").hidden = !host;
    $("roomGo").disabled = humans.length < 1;
    $("roomInviteBox").hidden = !host;
    $("roomWait").hidden = host;
    $("roomWait").textContent = `Aspetta che ${room.host} faccia partire la gara.`;
    renderOnline();
  }
  function humansHere() {
    const here = new Set(room.here || []);
    here.add(me());
    return (room.members || []).filter((m) => m.state === "joined" && here.has(m.name)).map((m) => m.name);
  }
  $("roomCircuit").addEventListener("change", () => {
    if (!host || !room) return;
    room.circuit = $("roomCircuit").value;
    roomCh && roomCh.send("circuit", { circuit: room.circuit });
    renderRoom();
  });

  // ------------------------------------------------------------- race
  $("roomGo").addEventListener("click", () => hostStart());
  async function hostStart() {
    if (!host || !room || started) return;
    const humans = humansHere().sort(() => Math.random() - 0.5);
    const circuit = circuitById(room.circuit), car = ctx.carById(room.car);
    const ai = aiSpecs(circuit, car, room.setup, null, 6 - humans.length);
    // random grid: real players and AI mixed
    const colors = COLORS.slice().sort(() => Math.random() - 0.5);
    const grid = [...humans.map((n, i) => ({ name: n, kind: "human", color: colors[i % colors.length] })), ...ai].sort(() => Math.random() - 0.5);
    const msg = { raceNo, circuit: room.circuit, car: room.car, setup: room.setup, grid };
    ctx.api.roomStatus(ctx.token(), room.id, "racing");
    roomCh.send("start", msg);
    beginRace(msg);
  }
  function beginRace(m) {
    if (!room) return;
    started = true; result = null; myFinish = null; sendAcc = 0; hostWatch = 0;
    raceNo = m.raceNo; room.circuit = m.circuit; room.car = m.car; room.setup = m.setup;
    hideInvite();
    ctx.startMpRace({ circuit: circuitById(m.circuit), car: ctx.carById(m.car), setup: m.setup, grid: m.grid, hostAI: host });
  }
  // called by the main loop every frame while an online race runs
  function tick(race, dt) {
    if (!roomCh || !race || !race.mp) return;
    sendAcc += dt;
    if (sendAcc >= SEND_EVERY) { sendAcc = 0; roomCh.send("st", { n: me(), rows: race.netState(host) }); }
    const now = performance.now();
    if (host && !result) {
      // everybody home (or dropped out) -> final order
      const lostOrDone = race.cars.every((c) => c.finished || (c.remote && c.human && (!c.seen || now - c.seen > LOST_AFTER) && race.t > 15));
      if (myFinish) hostWatch += dt;
      if (race.state !== "countdown" && (lostOrDone || hostWatch > 120)) sendResult(race);
    }
    if (!host && race.t > 20 && !result) {
      // no news from the host (it drives the AI): the challenge is over
      const h = race.cars.find((c) => c.remote && c.name === room.host);
      if (h && h.seen && now - h.seen > LOST_AFTER * 1.5) closed(`${room.host} si è scollegato: sfida finita.`);
    }
  }
  function onState(m) {
    const race = ctx.race();
    if (race && race.mp) race.applyNet(m.rows || [], performance.now());
  }
  function sendResult(race) {
    const rows = race.cars.map((c) => ({ name: c.name, human: !!c.human, time: c.finished ? Math.round(c.finishTime * 10) / 10 : null, best: c.best == null ? null : Math.round(c.best * 10) / 10, s: c.s }))
      .sort((a, b) => (a.time == null) - (b.time == null) || (a.time ?? 0) - (b.time ?? 0) || b.s - a.s)
      .map(({ s, ...r }) => r);
    const msg = { raceNo, order: rows };
    roomCh.send("result", msg);
    onResult(msg);
  }
  function onMyFinish(st) {
    myFinish = st;
    const h = $("hint"); h.className = "hint"; h.textContent = "Arrivato! Aspetta gli altri…"; h.hidden = false;
  }
  async function onResult(m) {
    if (result && result.raceNo === m.raceNo) return;
    result = m;
    const order = m.order;
    const humans = order.filter((o) => o.human);
    const winner = humans[0] ? humans[0].name : null;
    const myIdx = order.findIndex((o) => o.name === me());
    const mine = order[myIdx];
    ctx.endRaceKeepRoom();
    // results screen
    $("oTitle").textContent = winner === me() ? "Hai vinto la sfida!" : winner ? `Vince ${winner}` : "Sfida finita";
    $("oDist").textContent = mine && mine.time != null ? `${myIdx + 1}°` : "—"; $("oUnit").textContent = "su 6";
    $("oL1").textContent = "Tempo"; $("oTime").textContent = mine && mine.time != null ? ctx.fmtLap(mine.time) : "ritirato";
    $("oL2").textContent = "Giro migliore"; $("oCp").textContent = mine && mine.best != null ? ctx.fmtLap(mine.best) : "—";
    $("oL3").textContent = "Tra i giocatori"; $("oNear").textContent = mine ? `${humans.findIndex((h) => h.name === me()) + 1}° su ${humans.length}` : "—";
    $("oL4").textContent = "Premio"; $("oHit").textContent = "…";
    const ol = $("oOrder"); ol.textContent = ""; ol.hidden = false;
    const t0 = order[0] && order[0].time;
    order.forEach((o, i) => {
      const li = document.createElement("li"); if (o.name === me()) li.className = "me";
      const pos = document.createElement("b"); pos.textContent = `${i + 1}.`;
      const nm = document.createElement("span"); nm.className = "on"; nm.textContent = o.name;
      const sm = document.createElement("small"); sm.textContent = o.human ? " · giocatore" : " · IA"; nm.appendChild(sm);
      const tt = document.createElement("span"); tt.className = "ot";
      tt.textContent = o.time == null ? "non arrivato" : i === 0 ? ctx.fmtLap(o.time) : "+" + (o.time - t0).toFixed(1).replace(".", ",") + " s";
      li.append(pos, nm, tt); ol.appendChild(li);
    });
    $("oChamp").hidden = true; $("oUnlocks").textContent = "";
    $("oMp").hidden = false;
    $("again").hidden = true;
    $("toBox").textContent = "Esci dalla sfida";
    renderDecision(winner);
    ctx.show("scrOver");
    $("oBoardTitle").textContent = "Top 10 · Sfide";
    ctx.api.topChallenges().then((rows) => ctx.renderBoard($("oBoard"), rows, me(), "challenges"));
    // my result: coins + leaderboard
    const save = $("oSave");
    if (!mine || mine.time == null || !myFinish) { save.textContent = "Non sei arrivato al traguardo: nessun premio."; $("oHit").textContent = ctx.fmtC(0); return; }
    save.textContent = "Salvo il risultato…";
    const realRank = humans.findIndex((h) => h.name === me()) + 1;
    const r = await ctx.api.challengeResult(ctx.token(), room.id, m.raceNo, myIdx + 1, realRank, humans.length, mine.time, myFinish.best);
    if (r && r.profile) { ctx.setProfile(r.profile, true); save.textContent = `Salvato: +${ctx.fmtC(r.earned)}.`; $("oHit").textContent = ctx.fmtC(r.earned); }
    else save.textContent = ctx.ERRORS[r && r.error] || "Risultato non salvato.";
  }
  // the winner (first among the real players) decides: same circuit again, another circuit, or stop
  function renderDecision(winner) {
    const box = $("oMp"); box.textContent = "";
    if (winner !== me()) {
      const p = document.createElement("p"); p.className = "note";
      p.textContent = winner ? `Decide ${winner}: ripetere, cambiare pista o chiudere.` : "In attesa…";
      box.appendChild(p);
      return;
    }
    const p = document.createElement("p"); p.className = "note"; p.textContent = "Hai vinto tu: decidi come si continua.";
    const sel = document.createElement("select"); sel.id = "nextCircuit";
    for (const c of CIRCUITS) { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; if (c.id === room.circuit) o.selected = true; sel.appendChild(o); }
    const again = document.createElement("button"); again.className = "go"; again.textContent = "Ripeti la pista";
    again.addEventListener("click", () => decide(room.circuit, false));
    const change = document.createElement("button"); change.className = "ghost"; change.textContent = "Cambia pista";
    change.addEventListener("click", () => decide(sel.value, true));
    const row = document.createElement("div"); row.className = "actions"; row.append(again, sel, change);
    box.append(p, row);
  }
  async function decide(circuit, newCar) {
    const r = await ctx.api.roomNext(ctx.token(), room.id, circuit);
    if (!r || !r.room) { ctx.toast(ctx.ERRORS[r && r.error] || "Non riuscito.", "bad"); return; }
    const pick = newCar ? randomCarSetup() : { car: room.car, setup: room.setup };
    const msg = { circuit, raceNo: r.room.race_no, car: pick.car, setup: pick.setup };
    roomCh.send("next", msg);
    onNext(msg);
  }
  function onNext(m) {
    raceNo = m.raceNo; room.circuit = m.circuit; room.car = m.car; room.setup = m.setup;
    started = false; result = null; myFinish = null;
    $("oMp").hidden = true; $("again").hidden = false; $("toBox").textContent = "Box";
    showRoom();
    // the host starts the next race on its own after a short pause (time to switch steering mode)
    if (host) setTimeout(() => { if (room && !started) hostStart(); }, 4000);
    $("roomWait").textContent = "La prossima gara parte tra pochi secondi…";
  }

  // ------------------------------------------------------------- leaving
  async function exit() {
    if (!room) return;
    const id = room.id;
    if (roomCh) roomCh.send("exit", { by: me() });
    await ctx.api.roomLeave(ctx.token(), id);
    closed(null);
  }
  function closed(msg) {
    if (roomCh) { roomCh.close(); roomCh = null; }
    room = null; host = false; started = false; result = null; myFinish = null;
    $("oMp").hidden = true; $("again").hidden = false; $("toBox").textContent = "Box";
    setBusy(false);
    ctx.goHome();
    if (msg) ctx.toast(msg, "bad");
  }
  $("roomExit").addEventListener("click", exit);

  return {
    start, stop, tick, onMyFinish, exit,
    inChallenge: () => !!room,
    openLobbyRoom: async () => {          // "Sfida un amico" from home without picking anyone yet
      if (room) { showRoom(); return; }
      const pick = randomCarSetup();
      const r = await ctx.api.roomCreate(ctx.token(), CIRCUITS[0].id, pick.car, pick.setup);
      if (!r || !r.room) { ctx.toast(ctx.ERRORS[r && r.error] || "Sfida non creata.", "bad"); return; }
      host = true;
      await enterRoom(r.room);
    }
  };
}
