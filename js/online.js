// Online challenges: who is online, invitations, the waiting room on the circuit, the race between
// real players (the host also drives the AI that fill the grid up to 6), results and "what next".
import { openChannel } from "./net.js";
import { CARS, CIRCUITS, PARTS, PART_ORDER, COLORS, defaultConfig, circuitById } from "./data.js";
import { aiSpecs, circuitItems } from "./circuit.js";
import { Radio } from "./voice.js";

const $ = (id) => document.getElementById(id);
const SEND_EVERY = 0.1;            // seconds between state messages (10 per second)
const LOST_AFTER = 12000;          // ms without news: that player has dropped out

export function initOnline(ctx) {
  // ctx: { api, ERRORS, token(), profile(), setProfile, toast, show, goHome, startMpRace, endRace, mode(), fmtLap, fmtC,
  //        renderCtrl, ctrlBlock, carById, setupText, renderBoard, isRacing() }
  let lobby = null, online = [], room = null, roomCh = null, host = false, raceNo = 1;
  let pendingInvite = null, pollTimer = 0, sendAcc = 0, result = null, myFinish = null, hostWatch = 0, started = false;
  let mySave = null, doneT = 0;   // mySave: { raceNo, promise } — my own result, saved the moment I cross the line
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
    // someone joined or changed: refresh the list; the host repeats the race settings for newcomers
    roomCh.on("roster", () => { refreshRoom(); if (host && room) roomCh.send("circuit", { circuit: room.circuit, items: !!room.items }); });
    roomCh.on("circuit", (m) => { room.circuit = m.circuit; if ("items" in m) room.items = !!m.items; Object.assign(room, m.car ? { car: m.car, setup: m.setup } : {}); renderRoom(); });
    roomCh.on("take", (m) => { const r = ctx.race(); if (r && r.mp && m.raceNo === raceNo) r.takeItem(m.id); });
    roomCh.on("start", (m) => beginRace(m));
    roomCh.on("loaded", (m) => onLoaded(m));
    roomCh.on("go", () => { const r = ctx.race(); if (r && r.mp) r.go(); });
    roomCh.on("st", (m) => onState(m));
    roomCh.on("result", (m) => onResult(m));
    roomCh.on("next", (m) => onNext(m));
    roomCh.on("exit", (m) => onExitMsg(m));
    // voice radio: everybody can switch it on; it links to the others who have it on
    if (radio) radio.stop(true);
    radio = new Radio({ send: (t, d) => roomCh && roomCh.send(t, d), on: (t, f) => roomCh.on(t, f), me: me(), token: ctx.token, onChange: renderRadio });
    roomCh.track({ name: me() });
    if (!(await roomCh.subscribe())) ctx.toast("Collegamento in tempo reale non riuscito: riprova tra poco.", "bad");
    roomCh.send("roster", {});
    roomCh.send("radio", { n: me(), on: false, ask: 1 });
    showRoom();
  }
  async function refreshRoom() {
    if (!room) return;
    const r = await ctx.api.roomGet(ctx.token(), room.id);
    if (r && r.room) {
      const here = room.here, items = room.items;
      room = { ...r.room, here, items };
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
  // ------------------------------------------------------------- voice radio UI
  let radio = null;
  function renderRadio() {
    const on = !!(radio && radio.on);
    const b = $("radioBtn");
    if (b) { b.textContent = on ? "Radio: accesa" : "Accendi la radio"; b.classList.toggle("on-air", on); }
    const st = $("radioState");
    if (st) {
      const others = radio ? [...radio.wanted] : [];
      const linked = radio ? radio.linked() : [];
      st.textContent = !on ? (others.length ? `Radio accesa da: ${others.join(", ")}.` : "Nessuno ha la radio accesa.")
        : linked.length ? `In radio con: ${linked.join(", ")}.` : others.length ? `Collego ${others.join(", ")}…` : "Aspetto che qualcun altro accenda la radio.";
    }
    const mic = $("micBtn");
    mic.hidden = !on;
    mic.textContent = radio && radio.muted ? "MIC off" : "MIC";
    mic.classList.toggle("muted", !!(radio && radio.muted));
    ctx.duck(on && radio.linked().length > 0);
  }
  $("radioBtn").addEventListener("click", async () => {
    if (!radio) return;
    if (radio.on) { radio.stop(); return; }
    const r = await radio.start();
    if (r === "denied") ctx.toast("Microfono non permesso: abilitalo nelle impostazioni del browser.", "bad");
    else if (r === "unsupported") ctx.toast("Questo browser non supporta la radio.", "bad");
  });
  { let t = 0; const f = () => { if (radio && radio.on) radio.setMuted(!radio.muted); };
    $("micBtn").addEventListener("pointerdown", (e) => { e.preventDefault(); t = performance.now(); f(); });
    $("micBtn").addEventListener("click", () => { if (performance.now() - t > 700) f(); }); }
  setInterval(() => { if (radio && radio.on) renderRadio(); }, 2000);

  function renderRoom() {
    if (!room) return;
    renderRadio();
    const c = circuitById(room.circuit), car = ctx.carById(room.car);
    $("roomTitle").textContent = `Sfida · ${c ? c.name : room.circuit}`;
    const parts = ctx.setupText(room.setup).replace(/^ · /, "");
    $("roomSub").textContent = `Gara ${raceNo} · ${c ? c.laps : 3} giri. Auto uguale per tutti i giocatori: ${car.name}${parts ? " (" + parts + ")" : ", di serie"}.`;
    if (room.shownCar !== room.car + JSON.stringify(room.setup)) { room.shownCar = room.car + JSON.stringify(room.setup); ctx.showCar(car, room.setup); }
    const sel = $("roomCircuit");
    sel.disabled = !host || started;
    const ib = $("roomItems"); ib.disabled = !host || started; ib.checked = !!room.items;
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
    // "Parti" only when every invited player has answered and everyone who accepted is connected here
    const waiting = (room.members || []).filter((m) => m.state === "invited" || (m.state === "joined" && !here.has(m.name) && m.name !== me()));
    $("roomGo").disabled = waiting.length > 0;
    $("roomGo").textContent = waiting.length ? `Aspetto ${waiting.map((m) => m.name).join(", ")}…` : "Parti!";
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
    roomCh && roomCh.send("circuit", { circuit: room.circuit, items: !!room.items });
    renderRoom();
  });
  $("roomItems").addEventListener("change", () => {
    if (!host || !room) return;
    room.items = $("roomItems").checked;
    roomCh && roomCh.send("circuit", { circuit: room.circuit, items: room.items });
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
    const msg = { raceNo, circuit: room.circuit, car: room.car, setup: room.setup, grid, items: room.items ? circuitItems() : null };
    ctx.api.roomStatus(ctx.token(), room.id, "racing");
    roomCh.send("start", msg);
    beginRace(msg);
  }
  // Everybody builds the race, shows the track, then says "loaded". The host starts the countdown only
  // when every real player on the grid is looking at the track (or after 25 s for someone who never loads).
  let loaded = new Set(), gridHumans = [], loadWait = 0, goSent = false, loadTimer = 0;
  function beginRace(m) {
    if (!room) return;
    started = true; result = null; myFinish = null; sendAcc = 0; hostWatch = 0; doneT = 0; leaveBtn(false);
    raceNo = m.raceNo; room.circuit = m.circuit; room.car = m.car; room.setup = m.setup;
    loaded = new Set(); loadWait = 0; goSent = false;
    gridHumans = m.grid.filter((g) => g.kind === "human").map((g) => g.name);
    hideInvite();
    room.items = !!m.items;
    ctx.startMpRace({ circuit: circuitById(m.circuit), car: ctx.carById(m.car), setup: m.setup, grid: m.grid, hostAI: host, items: m.items });
    // the first frame of the track has been drawn: tell the others
    let said = false;
    const say = () => { if (said) return; said = true; const msg = { n: me(), raceNo }; if (roomCh) roomCh.send("loaded", msg); onLoaded(msg); };
    requestAnimationFrame(() => requestAnimationFrame(say));
    setTimeout(say, 1500);   // rAF can be paused when the tab is in the background
    // a "loaded" message may get lost: repeat it until the start, on a timer (works even if frames are throttled)
    clearInterval(loadTimer);
    loadTimer = setInterval(() => {
      const r = ctx.race();
      if (!r || !r.mp || r.state !== "waiting" || !roomCh) { clearInterval(loadTimer); return; }
      if (said) roomCh.send("loaded", { n: me(), raceNo });
      loadWait += 1.5;
      if (host) checkAllLoaded();
    }, 1500);
  }
  function onLoaded(m) {
    if (m.raceNo !== raceNo) return;
    loaded.add(m.n);
    if (host) { roomCh && roomCh.send("loaded", { ...m, echo: 1 }); checkAllLoaded(); }
  }
  function checkAllLoaded() {
    const race = ctx.race();
    if (!host || goSent || !race || !race.mp) return;
    if (gridHumans.every((n) => loaded.has(n)) || loadWait > 25) {
      goSent = true;
      roomCh && roomCh.send("go", { raceNo });
      race.go();
    }
  }
  // called by the main loop every frame while an online race runs
  function tick(race, dt) {
    if (!roomCh || !race || !race.mp) return;
    if (race.state === "waiting") {
      const missing = gridHumans.filter((n) => !loaded.has(n));
      const h = $("hint"); h.className = "hint"; h.hidden = false;
      h.textContent = missing.length ? `Aspetto che ${missing.join(", ")} ${missing.length > 1 ? "vedano" : "veda"} la pista…` : "Si parte!";
      return;
    }
    sendAcc += dt;
    if (sendAcc >= SEND_EVERY) { sendAcc = 0; roomCh.send("st", { n: me(), rows: race.netState(host) }); }
    const now = performance.now();
    if (host && !result) {
      // everybody home (or dropped out) -> final order
      // every real player home (or dropped out) -> final order. The AI cars do not hold it up:
      // whoever is still running is ranked by how far it got.
      const humansDone = race.cars.filter((c) => c.human).every((c) => c.finished || (c.remote && (!c.seen || now - c.seen > LOST_AFTER) && race.t > 15));
      if (humansDone) doneT += dt; else doneT = 0;
      if (myFinish) hostWatch += dt;
      if (race.state !== "countdown" && (doneT > 2 || hostWatch > 120)) sendResult(race);
    }
    if (!host && race.t > 20 && !result) {
      // no news from the host (it drives the AI): the challenge is over
      const h = race.cars.find((c) => c.remote && c.name === room.host);
      if (h && h.seen && now - h.seen > LOST_AFTER * 1.5) {
        // I'm already home: my result is saved; show the order as I see it instead of dropping everything
        if (myFinish) onResult({ ...localOrder(race), hostGone: true });
        else closed(`${room.host} si è scollegato: sfida finita.`);
      }
    }
  }
  function onState(m) {
    const race = ctx.race();
    // the host only sends race states after the start: if the "go" got lost, this is the start
    if (race && race.mp && race.state === "waiting" && room && m.n === room.host && !host) race.go();
    if (race && race.mp) race.applyNet(m.rows || [], performance.now());
  }
  function localOrder(race) {
    const rows = race.cars.map((c) => ({ name: c.name, human: !!c.human, time: c.finished ? Math.round(c.finishTime * 10) / 10 : null, best: c.best == null ? null : Math.round(c.best * 10) / 10, s: c.s }))
      .sort((a, b) => (a.time == null) - (b.time == null) || (a.time ?? 0) - (b.time ?? 0) || b.s - a.s)
      .map(({ s, ...r }) => r);
    return { raceNo, order: rows };
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
    // wait 1.5 s so that a car that crossed the line just before me is known here too, then save
    const r = ctx.race(), no = raceNo;
    setTimeout(() => { if (raceNo === no) saveMine(r); }, 1500);
    leaveBtn(true);
  }
  // My result goes to the server as soon as I cross the line: position = cars home before me + 1.
  // It does not depend on the organiser's phone staying connected until the end.
  function saveMine(race) {
    if (!race || !race.player || !myFinish || !room || (mySave && mySave.raceNo === raceNo)) return mySave && mySave.promise;
    const meCar = race.player, t = meCar.finishTime;
    const ahead = race.cars.filter((c) => c !== meCar && c.finished && c.finishTime < t);
    const position = Math.min(6, ahead.length + 1);
    const humans = race.cars.filter((c) => c.human).length;
    const realRank = Math.min(humans, ahead.filter((c) => c.human).length + 1);
    const vmax = myFinish.maxKmh > 0 ? Math.round(myFinish.maxKmh * 10) / 10 : null;
    const time = Math.round(t * 10) / 10, best = myFinish.best;
    const promise = ctx.api.challengeResult(ctx.token(), room.id, raceNo, position, realRank, humans, time, best, vmax)
      .then((r) => { if (r && r.profile) ctx.setProfile(r.profile, true); return { ...r, position }; })
      .catch(() => ({ error: "network" }));
    mySave = { raceNo, promise };
    return promise;
  }
  // a visible way out while waiting at the finish line
  function leaveBtn(on) {
    let b = $("mpLeave");
    if (!b && on) {
      b = document.createElement("button"); b.id = "mpLeave"; b.className = "ghost mp-leave"; b.textContent = "Esci dalla sfida";
      b.addEventListener("click", () => exit());
      document.getElementById("game") ? document.getElementById("game").appendChild(b) : document.body.appendChild(b);
    }
    if (b) b.hidden = !on;
  }
  async function onResult(m) {
    if (result && result.raceNo === m.raceNo) return;
    if (myFinish) saveMine(ctx.race());      // in case the finish came in the same frame as the result
    result = m;
    leaveBtn(false);
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
    const vm = myFinish && myFinish.maxKmh; $("oVmax").hidden = !(vm > 0); $("oVmax").textContent = vm > 0 ? `Velocità massima raggiunta: ${Math.round(vm)} km/h` : "";
    $("oMp").hidden = false;
    $("again").hidden = true;
    $("toBox").textContent = "Esci dalla sfida";
    if (m.hostGone) renderGone(); else renderDecision(winner);
    ctx.show("scrOver");
    $("oBoardTitle").textContent = "Top 10 · Sfide";
    ctx.api.topChallenges().then((rows) => ctx.renderBoard($("oBoard"), rows, me(), "challenges"));
    // my result: coins + leaderboard
    const save = $("oSave");
    if (!mine || mine.time == null || !myFinish) { save.textContent = "Non sei arrivato al traguardo: nessun premio."; $("oHit").textContent = ctx.fmtC(0); return; }
    save.textContent = "Salvo il risultato…";
    const r = await ((mySave && mySave.raceNo === m.raceNo && mySave.promise) || Promise.resolve({ error: "network" }));
    if (r && r.profile) { save.textContent = `Salvato in classifica Sfide: +${ctx.fmtC(r.earned)}.`; $("oHit").textContent = ctx.fmtC(r.earned); }
    else if (r && r.error === "duplicate") save.textContent = "Risultato già salvato.";
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
    again.addEventListener("click", () => decide(room.circuit));
    const change = document.createElement("button"); change.className = "ghost"; change.textContent = "Cambia pista";
    change.addEventListener("click", () => decide(sel.value));
    const nn = document.createElement("small"); nn.className = "note"; nn.textContent = "Ogni gara nuova: auto nuova estratta a caso.";
    const row = document.createElement("div"); row.className = "actions"; row.append(again, sel, change);
    box.append(p, row, nn);
  }
  async function decide(circuit) {
    const r = await ctx.api.roomNext(ctx.token(), room.id, circuit);
    if (!r || !r.room) { ctx.toast(ctx.ERRORS[r && r.error] || "Non riuscito.", "bad"); return; }
    const pick = randomCarSetup();   // every new race of a challenge: a new random car
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
  function onExitMsg(m) {
    if (!room) return;
    const stay = (room.members || []).filter((x) => x.state === "joined" && x.name !== m.by);
    if (m.by === room.host || stay.length < 2) { closed(`${m.by} ha chiuso la sfida.`); return; }
    room.members = (room.members || []).map((x) => (x.name === m.by ? { ...x, state: "left" } : x));
    ctx.toast(`${m.by} è uscito dalla sfida.`);
    if (result) {   // the one who had to decide is gone: the next real player decides
      const next = result.order.find((o) => o.human && room.members.some((x) => x.name === o.name && x.state === "joined"));
      renderDecision(next ? next.name : null);
    } else if (!started) renderRoom();
  }
  function renderGone() {
    const box = $("oMp"); box.textContent = "";
    const p = document.createElement("p"); p.className = "note";
    p.textContent = `${room.host} si è scollegato: la sfida è finita. Il tuo risultato è salvato.`;
    box.appendChild(p);
  }
  async function exit() {
    if (!room) return;
    const id = room.id;
    if (roomCh) roomCh.send("exit", { by: me() });
    await ctx.api.roomLeave(ctx.token(), id);
    closed(null);
  }
  function closed(msg) {
    if (radio) { radio.stop(); radio = null; renderRadio(); }
    if (roomCh) { roomCh.close(); roomCh = null; }
    room = null; host = false; started = false; result = null; myFinish = null;
    leaveBtn(false);
    $("oMp").hidden = true; $("again").hidden = false; $("toBox").textContent = "Box";
    setBusy(false);
    ctx.goHome();
    if (msg) ctx.toast(msg, "bad");
  }
  $("roomExit").addEventListener("click", exit);

  return {
    start, stop, tick, onMyFinish, exit,
    onTake: (id) => { if (roomCh) roomCh.send("take", { id, raceNo }); },
    debug: () => ({ loaded: [...loaded], gridHumans, raceNo, host, goSent, loadWait }),
    inChallenge: () => !!room,
    isHost: () => host,
    othersStay: () => !!room && (room.members || []).filter((x) => x.state === "joined" && x.name !== me()).length >= 2,
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
