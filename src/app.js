// 체스 오답노트 — Copyright (C) 2026 Katherine Nahm
// SPDX-License-Identifier: GPL-3.0-or-later
// 체스 오답노트 — main UI
import { Chess } from "../vendor/chess.js";
import { PIECE } from "./pieces.js";
import { Engine } from "./engine.js";
import { fetchChessCom, parsePgnFile, normalizeUser } from "./data.js";
import { findDecisiveMove, buildPuzzle, buildReport } from "./analyze.js";
import { t, LANG, setLang, applyStatic } from "./i18n.js";

applyStatic();
document.querySelectorAll(".langs button").forEach(b => { b.classList.toggle("on", b.dataset.lang === LANG); b.onclick = () => setLang(b.dataset.lang); });

const FILES = "abcdefgh";
const FILTERS = ["전체","안 푼 것","손버릇","기물 흘림","오프닝","잡을 수 있었음","이기던 판 놓침","메이트 있음"];
const QUALITY = { fast: [8, 11], normal: [10, 13], deep: [12, 16] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let USER = "", PUZ = [], REPORT = null, CACHE = null;
let store = {done:{}, clean:{}, habit:{}};
let filter = "전체", view = [], pos = 0, st = null;

/* ---------- storage ---------- */
const key = u => "ccq:v1:" + u.toLowerCase();
const isObj = x => !!x && typeof x === "object" && !Array.isArray(x);
const isStr = x => typeof x === "string";
const isUci = x => isStr(x) && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x);
const isSan = x => isStr(x) && /^[a-hKQRBNO1-8x=+#-]{2,10}$/.test(x);
const sameMove = (a, b) => a.slice(0,4) === b.slice(0,4) && (a[4] || "") === (b[4] || "");
const uciObj = u => ({from: u.slice(0,2), to: u.slice(2,4), promotion: u[4] || "q"});
// Only http(s) links: a PGN [Link] header or an old cache could hold a javascript: or data: URL.
function safeLink(u){
  try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; }
  catch(_) { return ""; }
}
// localStorage may hold an older, partial or hand-edited cache: keep only puzzles that load and play.
function validPuzzle(p){
  if (!isObj(p) || !isStr(p.id) || !isStr(p.fen) || (p.me !== "w" && p.me !== "b") || !isStr(p.date)) return false;
  if (!isSan(p.played) || !isUci(p.played_uci) || !(p.lastmove == null || isStr(p.lastmove))) return false;
  if (!Number.isFinite(p.eval_best) || !Number.isFinite(p.eval_played)) return false;
  if (![p.refline, p.san_line].every(a => Array.isArray(a) && a.every(isSan))) return false;
  if (!Array.isArray(p.theme) || !p.theme.every(isStr) || !Array.isArray(p.steps) || !p.steps.length) return false;
  if (!p.steps.every(s => isObj(s) && Array.isArray(s.accept) && s.accept.length && s.accept.every(isUci) && isUci(s.best) && (s.reply == null || isUci(s.reply)))) return false;
  try {
    new Chess(p.fen).move(uciObj(p.played_uci));
    const c = new Chess(p.fen);
    for (const s of p.steps){ c.move(uciObj(s.best)); if (s.reply) c.move(uciObj(s.reply)); }
  } catch(_) { return false; }
  return true;
}
function cleanProgress(pr){
  const out = {done:{}, clean:{}, habit:{}};
  if (isObj(pr)) for (const k of Object.keys(out)) if (isObj(pr[k])) out[k] = pr[k];
  return out;
}
function readCache(u){
  let c;
  try { c = JSON.parse(localStorage.getItem(key(u)) || "null"); } catch(_) { return null; }
  if (!isObj(c) || !Array.isArray(c.puzzles) || !Array.isArray(c.games)) return null;
  c.user = isStr(c.user) && c.user ? c.user : u;
  c.puzzles = c.puzzles.filter(validPuzzle);
  c.games = c.games.filter(g => isObj(g) && Number.isFinite(g.ts) && ["W","D","L"].includes(g.res));
  c.analyzed = Array.isArray(c.analyzed) ? c.analyzed.filter(isStr) : [];
  c.progress = cleanProgress(c.progress);
  return c;
}
function writeCache(){
  if (!CACHE) return;
  CACHE.progress = store;
  try { localStorage.setItem(key(USER), JSON.stringify(CACHE)); } catch(_) {}
  try {
    const list = savedUsers().filter(x => x.toLowerCase() !== USER.toLowerCase());
    list.unshift(USER); localStorage.setItem("ccq:users", JSON.stringify(list.slice(0, 6)));
  } catch(_) {}
}
const save = () => writeCache();
function savedUsers(){
  try { const a = JSON.parse(localStorage.getItem("ccq:users") || "[]"); return Array.isArray(a) ? a.filter(x => isStr(x) && x) : []; }
  catch(_) { return []; }
}

/* ---------- screens ---------- */
function show(name){
  for (const [id, n] of [["landing","home"],["progress","progress"],["puzzleView","puzzle"],["reportView","report"]])
    $(id).classList.toggle("hidden", n !== name);
  $("tabs").classList.toggle("hidden", !(name === "puzzle" || name === "report"));
  document.body.classList.toggle("inapp", name === "puzzle" || name === "report");
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  window.scrollTo(0, 0);
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  if (b.dataset.tab === "home"){ renderSaved(); show("home"); return; }
  if (b.dataset.tab === "report") renderReport();
  show(b.dataset.tab);
  if (b.dataset.tab === "puzzle" && st) draw();
});
$("logoIc").style.backgroundImage = `url("${PIECE.wn}")`;

function renderSaved(){
  const el = $("saved"); el.innerHTML = "";
  savedUsers().forEach(u => {
    const c = readCache(u); if (!c) return;
    const b = document.createElement("button");
    b.textContent = t("saved", {u, n: c.puzzles.length});
    b.onclick = () => openCache(u, c);
    el.appendChild(b);
  });
}

function openCache(u, c){
  USER = c.user || u; CACHE = c; PUZ = c.puzzles;
  store = cleanProgress(c.progress);
  filter = "전체"; pos = 0;
  REPORT = buildReport(c.games, PUZ);
  // rebuild the puzzle screen even with no puzzles, so it never keeps a previous user's board
  rebuildView(); load();
  if (!PUZ.length){ renderReport(); show("report"); return; }
  show("puzzle");
}

/* ---------- analysis pipeline ---------- */
let cancelled = false, engine = null, running = false;
const gameKey = g => g.key || g.link || String(g.ts);
$("cancelBtn").onclick = () => { cancelled = true; $("progSub").textContent = t("prog.wrap"); };

async function run(user, getGames){
  if (running) return;
  running = true;
  try { await runInner(user, getGames); }
  finally { running = false; }
}
async function runInner(user, getGames){
  $("err").textContent = "";
  cancelled = false;
  show("progress");
  $("progTitle").textContent = t("prog.loading"); $("progBar").style.width = "0%"; $("progSub").textContent = "";
  let games;
  try { games = await getGames(msg => $("progSub").textContent = msg); }
  catch (e){ show("home"); $("err").textContent = e.message || String(e); return; }
  const losses = games.filter(g => g.res === "L");
  if (!losses.length){ show("home"); $("err").textContent = t("err.noLoss"); return; }
  const prev = readCache(user);
  const done = new Set(prev ? prev.analyzed || [] : []);
  const puzzles = prev ? prev.puzzles.slice() : [];
  // legacy caches keyed PGN games without a link by their timestamp
  const seen = new Set();
  const todo = losses.filter(g => {
    const k = gameKey(g);
    if (seen.has(k) || done.has(k) || (!g.link && g.ts && done.has(String(g.ts)))) return false;
    seen.add(k); return true;
  });
  const [d1, d2] = QUALITY[$("quality").value] || QUALITY.normal;
  const g0 = games[0];
  const display = g0 ? (g0.me === "w" ? g0.white : g0.black) || user : user;
  USER = display;
  store = cleanProgress(prev && prev.progress);
  CACHE = { user: display, puzzles, analyzed: [...done], games: games.map(g => ({ts: g.ts, res: g.res})), progress: store, at: Date.now() };
  $("progTitle").textContent = todo.length ? t("prog.analyzing", {n: todo.length}) : t("prog.cached");
  if (todo.length){
    $("progSub").textContent = t("prog.engine");
    try { if (!engine || engine.dead) engine = new Engine(); await engine.ready; }
    catch (e){ engine = null; show("home"); $("err").textContent = t("err.engine") + " (" + e.message + ")"; return; }
  }
  const t0 = Date.now();
  let died = false;
  for (let i = 0; i < todo.length && !cancelled; i++){
    const g = todo[i];
    const left = i ? Math.round((Date.now() - t0) / i * (todo.length - i) / 1000) : null;
    $("progSub").textContent = `${i+1}/${todo.length} · vs ${g.me === "w" ? g.black : g.white}` + (left !== null ? t("prog.left", {t: left >= 60 ? t("unit.min", {n: Math.round(left/60)}) : t("unit.sec", {n: left})}) : "");
    $("progBar").style.width = (100 * i / todo.length) + "%";
    try {
      const d = await findDecisiveMove(engine, g, d1, () => cancelled);
      if (cancelled) break;
      if (d){
        const p = await buildPuzzle(engine, g, d, d2);
        if (p.steps.length) puzzles.push(p);
      }
      CACHE.analyzed.push(gameKey(g));
    } catch (e){
      console.warn("skip game", g.link, e);
      if (engine && engine.dead){ died = true; break; }
    }
    puzzles.sort((a, b) => b.date.localeCompare(a.date));
    CACHE.puzzles = puzzles; writeCache();
  }
  $("progBar").style.width = "100%";
  openCache(user, CACHE);
  if (died) notice(t("err.engineDied"));
}

// A one-off warning on whichever screen openCache() landed on.
function notice(text){
  const html = `<span style="color:#ffb3a9">${esc(text)}</span>`;
  if (!$("puzzleView").classList.contains("hidden")) $("msg").innerHTML = html;
  else $("reportView").insertAdjacentHTML("afterbegin", `<div class="err" style="margin:0 0 12px">${esc(text)}</div>`);
}

$("form").addEventListener("submit", e => {
  e.preventDefault();
  const raw = $("user").value.trim();
  if (!raw){ $("err").textContent = t("err.empty"); return; }
  const user = normalizeUser(raw);
  if (!user){ $("err").textContent = t("err.badId"); return; }
  const tcs = [...document.querySelectorAll(".tc:checked")].map(x => x.value);
  if (!tcs.length){ $("err").textContent = t("err.noTc"); return; }
  const want = +$("nLoss").value;
  run(user, onProgress => fetchChessCom(user, { timeClasses: tcs, wantLosses: want, onProgress }).then(gs => {
    // keep games up to the oldest of the wanted losses
    let n = 0, cut = gs.length;
    for (let i = 0; i < gs.length; i++){ if (gs[i].res === "L" && ++n === want){ cut = i + 1; break; } }
    return gs.slice(0, cut);
  }));
});
$("pgnFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  const raw = $("user").value.trim();
  const user = normalizeUser(raw) || raw.toLowerCase();
  if (!raw){ $("err").textContent = t("err.pgnId"); e.target.value = ""; return; }
  let text;
  try { text = await f.text(); }
  catch (_){ $("err").textContent = t("err.pgnRead"); e.target.value = ""; return; }
  const want = +$("nLoss").value;
  run(user, async () => {
    const gs = parsePgnFile(text, user);
    if (!gs.length) throw new Error(t("err.pgnNone"));
    let n = 0, cut = gs.length;
    for (let i = 0; i < gs.length; i++){ if (gs[i].res === "L" && ++n === want){ cut = i + 1; break; } }
    return gs.slice(0, cut);
  });
  e.target.value = "";
});

/* ---------- report ---------- */
function pct(a, b){ return b ? Math.round(100 * a / b) + "%" : "-"; }
function renderReport(){
  const r = REPORT; if (!r) return;
  const tt = r.total;
  const rules = [];
  if (r.after2.n >= 4 && r.after2.L / r.after2.n > r.fresh.L / Math.max(r.fresh.n, 1) + 0.1)
    rules.push(t("rep.tilt", {a: pct(r.fresh.L, r.fresh.n), b: pct(r.after2.L, r.after2.n)}));
  else rules.push(t("rep.noTilt", {a: pct(r.fresh.L, r.fresh.n), b: pct(r.after2.L, r.after2.n)}));
  if (r.nPuz && r.early / r.nPuz >= 0.4) rules.push(t("rep.early", {p: pct(r.early, r.nPuz)}));
  if (r.nPuz && r.hung / r.nPuz >= 0.4) rules.push(t("rep.hung", {n: r.hung}));
  if (r.thrown) rules.push(t("rep.thrown", {n: r.thrown}));
  if (r.missed) rules.push(t("rep.missed", {n: r.missed}));
  $("reportView").innerHTML = `
    <h2>${t("rep.title", {u: esc(USER)})}</h2>
    <div class="rgrid">
      <div class="rcard"><b>${tt.n}</b><span>${t("rep.games", {w: tt.W, d: tt.D, l: tt.L})}</span></div>
      <div class="rcard"><b>${r.nPuz}</b><span>${t("rep.puzzles")}</span></div>
      <div class="rcard"><b>${r.longest}</b><span>${t("rep.streak")}</span></div>
      <div class="rcard"><b>${pct(r.after2.L, r.after2.n)}</b><span>${t("rep.after2")}</span></div>
    </div>
    <div class="advice"><ul style="margin:0;padding-left:18px">${rules.map(x => `<li>${x}</li>`).join("")}</ul></div>
    <div class="small">${t("rep.note")}</div>`;
}

/* ---------- puzzle view ---------- */
function rebuildView(keepId){
  view = PUZ.map((p,i)=>i).filter(i => {
    const p = PUZ[i];
    if (filter === "전체") return true;
    if (filter === "안 푼 것") return !store.done[p.id];
    if (filter === "손버릇") return !!store.habit[p.id];
    return p.theme.includes(filter);
  });
  if (keepId !== undefined){ const k = view.indexOf(keepId); pos = k >= 0 ? k : 0; }
  if (pos >= view.length) pos = 0;
}

function renderSide(){
  const f = $("filters"); f.innerHTML = "";
  FILTERS.forEach(name => {
    const n = name === "전체" ? PUZ.length : name === "안 푼 것" ? PUZ.filter(p=>!store.done[p.id]).length
      : name === "손버릇" ? PUZ.filter(p=>store.habit[p.id]).length : PUZ.filter(p=>p.theme.includes(name)).length;
    if (!n && !["안 푼 것","손버릇"].includes(name)) return;
    const b = document.createElement("button");
    b.className = "chip" + (name === filter ? " on" : "");
    b.textContent = `${t("f." + name)} ${n}`;
    b.onclick = () => { const cur = view[pos]; filter = name; rebuildView(cur); renderSide(); load(); };
    f.appendChild(b);
  });
  const g = $("grid"); g.innerHTML = "";
  view.forEach((i, k) => {
    const b = document.createElement("button");
    const p = PUZ[i];
    b.textContent = k + 1;
    if (store.done[p.id]) b.classList.add("done");
    if (store.habit[p.id]) b.classList.add("habit");
    if (k === pos) b.classList.add("cur");
    b.title = `${p.date} vs ${p.opp}`;
    b.onclick = () => { pos = k; load(); if (innerWidth <= 900) $("puzzleView").scrollIntoView({ behavior: "smooth", block: "start" }); };
    g.appendChild(b);
  });
  $("sDone").textContent = `${PUZ.filter(p=>store.done[p.id]).length}/${PUZ.length}`;
  $("sClean").textContent = PUZ.filter(p=>store.clean[p.id]).length;
  $("sHabit").textContent = PUZ.filter(p=>store.habit[p.id]).length;
}

function setTop(kind, title, sub){
  const top = $("ptop"); top.className = "ptop " + kind;
  const ic = $("pic");
  if (kind === "w" || kind === "b"){ ic.className = "ic"; ic.style.backgroundImage = `url("${PIECE[kind + "k"]}")`; ic.textContent = ""; }
  else { ic.className = "ic circ"; ic.style.backgroundImage = "none"; ic.textContent = kind === "ok" ? "✓" : "✕"; }
  $("ptxt").innerHTML = title + (sub ? `<small>${sub}</small>` : "");
}
const msg = h => { $("msg").innerHTML = h; };
const turnTxt = c => c === "w" ? t("pz.turnW") : t("pz.turnB");

function load(){
  $("promo").classList.remove("show");
  drag = null; clearGhosts();
  if (!view.length){
    st = null;
    $("board").innerHTML = ""; $("explain").classList.remove("show"); $("count").textContent = "0 / 0";
    if (PUZ.length) setTop("ok", t("pz.allDone"), t("pz.allDoneSub"));
    else setTop("ok", t("pz.none"), t("pz.noneSub"));
    msg(""); renderSide(); return;
  }
  const idx = view[pos], p = PUZ[idx];
  const game = new Chess(p.fen);
  st = {p, idx, game, step:0, sel:null, hint:0, last:p.lastmove, done:false, busy:false, wrongs:0, usedAnswer:false, badge:null, hintSq:[]};
  const meW = p.me === "w";
  $("oppName").textContent = p.opp;
  $("meName").textContent = USER;
  $("oppAv").style.backgroundImage = `url("${PIECE[(meW ? "b" : "w") + "k"]}")`;
  $("meAv").style.backgroundImage = `url("${PIECE[p.me + "k"]}")`;
  setTop(p.me, turnTxt(p.me), p.steps.length > 1 ? t("pz.findN", {n: p.steps.length}) : t("pz.find"));
  $("meta").textContent = t("pz.meta", {d: p.date.replaceAll(".","/"), n: p.moveno});
  const link = safeLink(p.link);
  $("glink").href = link || "#"; $("glink").style.visibility = link ? "visible" : "hidden";
  $("tags").innerHTML = (store.habit[p.id] ? `<span class="tag warn">${t("f.손버릇")}</span>` : "") + p.theme.map(x=>`<span class="tag">${t("f." + x)}</span>`).join("");
  msg(t("pz.howto"));
  $("explain").classList.remove("show");
  $("count").textContent = `${pos+1} / ${view.length}`;
  $("nextBtn").textContent = t("btn.next");
  draw(); renderSide();
  }

/* ---------- board rendering ---------- */
function sqName(r, f){ const flip = st.p.me === "b"; return (flip ? FILES[7-f] : FILES[f]) + (flip ? r + 1 : 8 - r); }
function sqEl(sq){ return document.querySelector(`.sq[data-sq="${sq}"]`); }

function draw(){
  if (!st) return;
  const el = $("board"); el.innerHTML = "";
  const flip = st.p.me === "b";
  const legal = st.sel ? st.game.moves({square: st.sel, verbose: true}) : [];
  const targets = {}; legal.forEach(m => targets[m.to] = m.captured || m.flags.includes("e") ? "cap" : "dot");
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++){
    const sq = sqName(r, f);
    const fi = FILES.indexOf(sq[0]), rk = +sq[1];
    const d = document.createElement("div");
    d.className = "sq " + ((fi + rk) % 2 === 0 ? "l" : "d");
    d.dataset.sq = sq;
    if ((st.last && (st.last.slice(0,2) === sq || st.last.slice(2,4) === sq)) || st.sel === sq) d.classList.add("hl");
    if (st.hintSq.includes(sq)) d.classList.add("hint");
    if (targets[sq]) d.classList.add(targets[sq]);
    if (f === 0){ const c = document.createElement("span"); c.className = "coord r"; c.textContent = rk; d.appendChild(c); }
    if (r === 7){ const c = document.createElement("span"); c.className = "coord f"; c.textContent = sq[0]; d.appendChild(c); }
    const pc = st.game.get(sq);
    if (pc){
      const s = document.createElement("div");
      s.className = "pc" + (pc.color === st.p.me && !st.done ? " mine" : "");
      s.style.backgroundImage = `url("${PIECE[pc.color + pc.type]}")`;
      d.appendChild(s);
    }
    if (st.badge && st.badge.sq === sq){
      const b = document.createElement("div");
      b.className = "badge " + st.badge.kind;
      b.textContent = st.badge.kind === "bad" ? "✕" : st.badge.kind === "best" ? "★" : "✓";
      d.appendChild(b);
    }
    el.appendChild(d);
  }
}

/* ---------- input ---------- */
let drag = null, boardBound = false;
function sqAt(x, y){ const el = document.elementFromPoint(x, y); const s = el && el.closest && el.closest(".sq"); return s ? s.dataset.sq : null; }
function clearGhosts(){ document.querySelectorAll(".pc.drag").forEach(g => g.remove()); }
function bindBoard(){
  if (boardBound) return; boardBound = true;
  const bd = $("board");
  bd.addEventListener("pointerdown", e => {
    if (!st || st.done || st.busy) return;
    if (e.button !== undefined && e.button > 0) return;
    const sq = sqAt(e.clientX, e.clientY); if (!sq) return;
    e.preventDefault();
    clearGhosts();
    const pc = st.game.get(sq);
    drag = {from: sq, own: !!(pc && pc.color === st.p.me), sx: e.clientX, sy: e.clientY, moved: false, ghost: null, over: null, id: e.pointerId};
    try { bd.setPointerCapture(e.pointerId); } catch(_) {}
  });
  bd.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved){
      if (!drag.own || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 6) return;
      drag.moved = true;
      st.sel = drag.from; draw();
      const node = sqEl(drag.from).querySelector(".pc");
      const r = node.getBoundingClientRect();
      const g = node.cloneNode(); g.classList.add("drag");
      g.style.width = r.width + "px"; g.style.height = r.height + "px";
      document.body.appendChild(g); drag.ghost = g; drag.w = r.width;
      node.style.opacity = ".35";
    }
    drag.ghost.style.left = (e.clientX - drag.w/2) + "px";
    drag.ghost.style.top = (e.clientY - drag.w/2) + "px";
    const s = sqAt(e.clientX, e.clientY);
    if (s !== drag.over){ if (drag.over) sqEl(drag.over)?.classList.remove("over"); drag.over = s; if (s && s !== drag.from) sqEl(s)?.classList.add("over"); }
  });
  const end = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    clearGhosts();
    try { bd.releasePointerCapture(e.pointerId); } catch(_) {}
    if (!st) return;
    if (cancel){ draw(); return; }
    if (d.moved){
      const to = sqAt(e.clientX, e.clientY);
      if (to && to !== d.from) tryMove(d.from, to); else draw();
    } else clickSq(d.from);
  };
  bd.addEventListener("pointerup", e => end(e, false));
  bd.addEventListener("pointercancel", e => end(e, true));
  bd.addEventListener("lostpointercapture", e => { if (drag && e.pointerId === drag.id) end(e, true); });
}
function clickSq(sq){
  if (st.done || st.busy) return;
  const pc = st.game.get(sq);
  if (st.sel && st.sel !== sq && !(pc && pc.color === st.p.me)){ tryMove(st.sel, sq); return; }
  if (pc && pc.color === st.p.me){ st.sel = st.sel === sq ? null : sq; draw(); return; }
  st.sel = null; draw();
}

function tryMove(from, to){
  const legal = st.game.moves({square: from, verbose: true}).filter(m => m.to === to);
  st.sel = null;
  if (!legal.length){ draw(); return; }
  if (legal.some(m => m.promotion)){ askPromo(from, to); return; }
  attempt(from + to);
}

function askPromo(from, to){
  const pr = $("promo"); pr.innerHTML = "";
  const cur = st;
  const flip = st.p.me === "b";
  const fi = FILES.indexOf(to[0]);
  const col = document.createElement("div"); col.className = "col";
  col.style.left = ((flip ? 7 - fi : fi) * 12.5) + "%"; col.style.top = "0";
  ["q","n","r","b"].forEach(k => {
    const c = document.createElement("div");
    c.style.backgroundImage = `url("${PIECE[st.p.me + k]}")`;
    c.onclick = e => { e.stopPropagation(); pr.classList.remove("show"); if (st === cur) attempt(from + to + k); };
    col.appendChild(c);
  });
  pr.appendChild(col);
  pr.onclick = () => { pr.classList.remove("show"); draw(); };
  pr.classList.add("show");
}

/* ---------- puzzle logic ---------- */
function play(uci){
  const m = st.game.move({from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || "q"});
  st.last = uci.slice(0,4); return m;
}

function attempt(uci){
  const p = st.p, step = p.steps[st.step], cur = st;
  const real = step.accept.find(a => sameMove(a, uci));
  const ok = !!real;
  const isPlayed = st.step === 0 && sameMove(p.played_uci, uci);
  if (!ok){
    st.wrongs++;
    play(uci); st.badge = {sq: uci.slice(2,4), kind: "bad"}; st.hintSq = []; draw();
    st.busy = true;
    if (isPlayed && !st.usedAnswer){
      if (!store.habit[p.id]){ store.habit[p.id] = 1; save(); }
      setTop("bad", t("pz.habit"), t("pz.habitSub"));
      msg(t("pz.habitMsg", {m: `<span class="mv">${p.played}</span>`, r: `<span class="mv">${p.refline[0] || "?"}</span>`}));
    } else {
      setTop("bad", t("pz.wrong"), t("pz.again"));
      msg(t("pz.wrongMsg"));
    }
    setTimeout(() => {
      if (st !== cur) return;
      st.game.undo(); st.last = st.step === 0 ? p.lastmove : p.steps[st.step-1].reply; st.badge = null; st.busy = false;
      setTop(p.me, turnTxt(p.me), t("pz.again")); draw(); renderSide();
    }, 900);
    return;
  }
  play(real);
  const isBest = sameMove(real, step.best);
  st.badge = {sq: real.slice(2,4), kind: isBest ? "best" : "ok"}; st.hintSq = [];
  st.step++;
  draw();
  if (st.step >= p.steps.length){ finish(true); return; }
  setTop("ok", isBest ? t("pz.best") : t("pz.good"), t("pz.goOn"));
  msg(t("pz.replying"));
  st.busy = true;
  setTimeout(() => {
    if (st !== cur) return;
    play(step.reply); st.badge = null; st.busy = false;
    setTop(p.me, turnTxt(p.me), t("pz.next"));
    msg(t("pz.continue")); draw();
  }, 700);
}

function finish(solved){
  st.done = true;
  const p = st.p;
  if (solved && !st.usedAnswer){
    store.done[p.id] = 1;
    if (st.wrongs === 0 && st.hint === 0) store.clean[p.id] = 1;
    save();
  }
  if (solved && !st.usedAnswer){
    setTop("ok", st.wrongs === 0 && st.hint === 0 ? t("pz.clean") : t("pz.solved"), t("pz.solvedSub"));
    msg(store.habit[p.id] ? t("pz.beatHabit") : t("pz.nice"));
  } else {
    setTop("bad", t("pz.revealed"), t("pz.later"));
    msg("");
  }
  showExplain(); draw(); renderSide();
}

function numbered(arr, startNo, whiteFirst){
  let n = startNo, white = whiteFirst, out = [];
  arr.forEach((m, i) => {
    out.push(white ? `${n}.${m}` : (i === 0 ? `${n}...${m}` : m));
    if (!white) n++;
    white = !white;
  });
  return out.join(" ");
}
function evalTxt(v){ if (Math.abs(v) >= 90000) return v > 0 ? t("ev.mate") : t("ev.mated"); return (v > 0 ? "+" : "") + (v/100).toFixed(1); }
function showExplain(){
  const p = st.p, meW = p.me === "w";
  $("explain").innerHTML =
    `<b>${t("ex.line")}</b> <span style="float:right">${evalTxt(p.eval_best)}</span><br><span class="mv">${numbered(p.san_line, p.moveno, meW)}</span><br>` +
    `<b>${t("ex.played")}</b> <span class="mv">${p.played}</span> <span style="float:right">${evalTxt(p.eval_played)}</span><br>` +
    `${t("ex.punish")} <span class="mv">${numbered(p.refline, meW ? p.moveno : p.moveno + 1, !meW)}</span><br>` +
    `<span style="font-size:12px;color:var(--dim)">${t("ex.note")}</span>`;
  $("explain").classList.add("show");
}

$("hintBtn").onclick = () => {
  if (!st || st.done || st.busy) return;
  const best = st.p.steps[st.step].best;
  st.hint++;
  st.hintSq = st.hint === 1 ? [best.slice(0,2)] : [best.slice(0,2), best.slice(2,4)];
  msg(st.hint === 1 ? t("pz.hint1") : t("pz.hint2"));
  draw();
};
$("showBtn").onclick = () => {
  if (!st || st.done || st.busy) return;
  st.usedAnswer = true; st.busy = true; st.hintSq = [];
  const cur = st;
  const go = () => {
    if (st !== cur) return;
    const s = st.p.steps[st.step];
    play(s.best); st.badge = {sq: s.best.slice(2,4), kind: "best"}; st.step++; draw();
    if (st.step < st.p.steps.length && s.reply){
      setTimeout(() => { if (st !== cur) return; play(s.reply); st.badge = null; draw(); setTimeout(go, 650); }, 650);
    } else { st.busy = false; finish(false); }
  };
  go();
};
$("playedBtn").onclick = () => {
  if (!st || st.busy) return;
  const p = st.p, cur = st;
  st.game = new Chess(p.fen); st.step = 0; st.sel = null; st.hintSq = []; st.done = true; st.busy = true;
  play(p.played_uci); st.badge = {sq: p.played_uci.slice(2,4), kind: "bad"}; draw();
  setTop("bad", t("pz.playedTop", {m: p.played}), t("pz.playedSub"));
  setTimeout(() => {
    if (st !== cur) return;
    if (p.refline[0]){
      const m = st.game.move(p.refline[0]);
      if (m){ st.last = m.from + m.to; st.badge = null; }
    }
    st.busy = false; draw(); showExplain();
    msg(t("pz.playedMsg", {r: `<span class="mv">${p.refline[0] || ""}</span>`}));
  }, 900);
};
$("retryBtn").onclick = () => load();
$("prevBtn").onclick = () => { if (!view.length) return; pos = (pos - 1 + view.length) % view.length; load(); };
$("nextBtn").onclick = () => {
  if (!view.length) return;
  if (filter === "안 푼 것"){ const cur = view[pos]; rebuildView(); const k = view.findIndex(i => i > cur); pos = k >= 0 ? k : 0; }
  else pos = (pos + 1) % view.length;
  load();
};
document.addEventListener("keydown", e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || $("puzzleView").classList.contains("hidden")) return;
  if (e.key === "ArrowRight") $("nextBtn").click();
  if (e.key === "ArrowLeft") $("prevBtn").click();
});


bindBoard();
renderSaved();
try { const last = savedUsers()[0]; if (last) $("user").value = last; } catch(_) {}
