// 체스 오답노트 — Copyright (C) 2026 Katherine Nahm
// SPDX-License-Identifier: GPL-3.0-or-later
// 체스 오답노트 — main UI
import { Chess } from "../vendor/chess.js";
import { PIECE } from "./pieces.js";
import { Engine } from "./engine.js";
import { fetchChessCom, parsePgnFile, normalizeUser } from "./data.js";
import { findDecisiveMove, buildPuzzle, buildReport, hungPiece, GEN } from "./analyze.js";
import { t, LANG, setLang, applyStatic } from "./i18n.js";

applyStatic();
// switching reloads the page, so never while an analysis is running (the switcher is hidden then too)
document.querySelectorAll(".langs button").forEach(b => { b.classList.toggle("on", b.dataset.lang === LANG); b.onclick = () => { if (b.dataset.lang !== LANG && !running) setLang(b.dataset.lang); }; });

const FILES = "abcdefgh";
const FILTERS = ["전체","안 푼 것","손버릇","기물 흘림","오프닝","잡을 수 있었음","이기던 판 놓침","메이트 있음"];
const QUALITY = { fast: [8, 11], normal: [10, 13], deep: [12, 16] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let USER = "", PUZ = [], REPORT = null, CACHE = null;
let store = {done:{}, clean:{}, habit:{}, miss:{}};
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
  if (p.ok === 1) return true; // replayed once already (the replay is the slow part with hundreds of puzzles)
  try {
    new Chess(p.fen).move(uciObj(p.played_uci));
    const c = new Chess(p.fen);
    for (const s of p.steps){ c.move(uciObj(s.best)); if (s.reply) c.move(uciObj(s.reply)); }
  } catch(_) { return false; }
  p.ok = 1;
  return true;
}
// miss: the puzzle was once failed, hinted or revealed, so it can no longer be a first-try solve
function cleanProgress(pr){
  const out = {done:{}, clean:{}, habit:{}, miss:{}};
  if (isObj(pr)) for (const k of Object.keys(out)) if (isObj(pr[k])) out[k] = pr[k];
  return out;
}
// Tags that can be recomputed from what a puzzle stores, so puzzles saved by older versions get them right.
function retag(p){
  if (p.tg === 2) return; // tagged by this version already
  const th = p.theme.filter(x => !["기물 흘림", "메이트 있음", "오프닝", "포지션"].includes(x));
  if (Math.abs(p.eval_played) < 90000 && hungPiece(p.fen, p.played_uci, p.refline)) th.unshift("기물 흘림");
  if (p.eval_best >= 90000 || p.san_line.some((s, i) => i % 2 === 0 && s.endsWith("#"))) th.push("메이트 있음");
  if (p.moveno <= 10) th.push("오프닝");
  if (!th.length) th.push("포지션");
  p.theme = th;
  p.tg = 2;
}
// skip: ids of puzzles the caller is about to overwrite, so validating and retagging them is wasted work
function readCache(u, skip){
  let c;
  try { c = JSON.parse(localStorage.getItem(key(u)) || "null"); } catch(_) { return null; }
  if (!isObj(c) || !Array.isArray(c.puzzles) || !Array.isArray(c.games)) return null;
  c.user = isStr(c.user) && c.user ? c.user : u;
  // analyzed: {gameKey: [generator, depth]}; caches from before generators existed list keys only
  const an = {};
  if (Array.isArray(c.analyzed)) c.analyzed.forEach(k => { if (isStr(k)) an[k] = [0, 0]; });
  else if (isObj(c.analyzed)) for (const [k, v] of Object.entries(c.analyzed)) if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)) an[k] = v;
  const trusted = p => !!skip && isObj(p) && skip.has(p.id);
  let fresh = false; // some puzzle was checked or retagged for the first time: worth saving the marks
  const kept = c.puzzles.filter(p => {
    if (trusted(p)) return true;
    const known = isObj(p) && p.ok === 1 && p.tg === 2;
    const v = validPuzzle(p);
    if (v && !known) fresh = true;
    return v;
  }), keptSet = new Set(kept);
  // the game of a dropped puzzle gets analysed again
  for (const p of c.puzzles) if (!keptSet.has(p) && isObj(p) && isStr(p.id)){ delete an[p.id]; if (/^\d+-\d+$/.test(p.id)) delete an[p.id.split("-")[0]]; }
  kept.forEach(p => { if (!trusted(p)) retag(p); });
  c.puzzles = kept;
  c.analyzed = an;
  c.games = c.games.filter(g => isObj(g) && Number.isFinite(g.ts) && ["W","D","L"].includes(g.res));
  c.progress = cleanProgress(c.progress);
  Object.defineProperty(c, "fresh", { value: fresh }); // not saved
  return c;
}
// Another tab may have saved since this one loaded, so merge instead of overwriting: puzzles, analysed
// games and progress only grow, except what this tab replaced on purpose since its last save.
const removedIds = new Set(), resets = new Map(); // resets: puzzle id -> progress maps to drop for it
const rank = v => Array.isArray(v) ? v[0] * 1000 + v[1] : -1; // [generator, depth]: newer analysis ranks higher
function mergeCache(old, cur){
  if (!old) return cur;
  const analyzed = Object.assign({}, old.analyzed);
  for (const [k, v] of Object.entries(cur.analyzed)) if (rank(v) >= rank(analyzed[k])) analyzed[k] = v;
  const byId = new Map(old.puzzles.filter(p => !removedIds.has(p.id)).map(p => [p.id, p]));
  for (const p of cur.puzzles){
    // a tab opened before another tab re-analysed this game must not put the old puzzle back
    if (byId.has(p.id) && rank(old.analyzed[p.id]) > rank(cur.analyzed[p.id])) continue;
    byId.set(p.id, p);
  }
  const progress = {};
  for (const k of ["done", "clean", "habit", "miss"]){
    const o = Object.assign({}, old.progress[k]);
    resets.forEach((maps, id) => { if (maps.has(k)) delete o[id]; });
    progress[k] = Object.assign(o, cur.progress[k]);
  }
  const newer = (old.at || 0) > (cur.at || 0) ? old : cur;
  return { ...cur, puzzles: [...byId.values()].sort((a, b) => b.date.localeCompare(a.date)),
    analyzed, progress, games: newer.games, at: newer.at };
}
let saveWarned = false;
function writeCache(){
  if (!CACHE) return;
  CACHE.progress = store;
  const merged = mergeCache(readCache(USER, new Set(CACHE.puzzles.map(p => p.id))), CACHE);
  Object.assign(store, merged.progress);
  try {
    localStorage.setItem(key(USER), JSON.stringify(merged));
    removedIds.clear(); resets.clear(); // applied once; later saves must not undo other tabs' work
  }
  catch (e){
    console.warn("ccq: could not save", e);
    if (!saveWarned){ saveWarned = true; alert(t("err.save")); }
  }
  try {
    const list = savedUsers().filter(x => x.toLowerCase() !== USER.toLowerCase());
    list.unshift(USER); localStorage.setItem("ccq:users", JSON.stringify(list.slice(0, 6)));
  } catch(_) {}
}
const save = () => writeCache();
const markMiss = id => { if (!store.miss[id]){ store.miss[id] = 1; save(); } };
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
  const langs = document.querySelector(".foot .langs"); if (langs) langs.classList.toggle("hidden", name === "progress");
  window.scrollTo(0, 0);
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  if (b.dataset.tab === "home"){ renderSaved(); show("home"); return; }
  if (b.dataset.tab === "report") renderReport();
  show(b.dataset.tab);
  if (b.dataset.tab === "puzzle" && st) draw();
});
$("logoIc").style.backgroundImage = `url("${PIECE.wn}")`;

// The start screen only counts puzzles; the full (validating) read happens when one is opened.
function peekCount(u){
  try { const c = JSON.parse(localStorage.getItem(key(u)) || "null"); return isObj(c) && Array.isArray(c.puzzles) && Array.isArray(c.games) ? c.puzzles.length : -1; }
  catch(_) { return -1; }
}
function renderSaved(){
  const el = $("saved"); el.innerHTML = "";
  savedUsers().forEach(u => {
    const n = peekCount(u); if (n < 0) return;
    const b = document.createElement("button");
    b.textContent = t("saved", {u, n});
    b.onclick = () => { const c = readCache(u); if (!c){ renderSaved(); return; } openCache(u, c); if (c.fresh) save(); };
    el.appendChild(b);
  });
}

function openCache(u, c){
  USER = c.user || u; CACHE = c; PUZ = c.puzzles;
  store = cleanProgress(c.progress);
  filter = "전체"; pos = 0;
  // the report covers the games of the last run; puzzles from older runs stay in the puzzle list
  const inWin = new Set(c.games.map(g => g.k).filter(isStr));
  REPORT = buildReport(c.games, inWin.size ? PUZ.filter(p => inWin.has(p.id)) : PUZ);
  // rebuild the puzzle screen even with no puzzles, so it never keeps a previous user's board
  rebuildView(); load();
  if (!PUZ.length){ renderReport(); show("report"); return; }
  show("puzzle");
}

/* ---------- analysis pipeline ---------- */
let cancelled = false, engine = null, running = false, aborter = null;
const gameKey = g => g.key || g.link || String(g.ts);
$("cancelBtn").onclick = () => {
  cancelled = true; $("progSub").textContent = t("prog.wrap");
  if (aborter) aborter.abort();
  if (engine && !engine.dead) engine.cancel();
};

async function run(user, getGames){
  if (running) return;
  running = true;
  try { await runInner(user, getGames); }
  catch (e){
    console.error("analysis failed", e);
    show("home"); $("err").textContent = t("err.unexpected") + " (" + (e && e.message || e) + ")";
  }
  finally {
    running = false; aborter = null;
    // solving needs no engine: release the worker and its memory until the next run
    if (engine){ engine.stop(); engine = null; }
  }
}
async function runInner(user, getGames){
  $("err").textContent = "";
  cancelled = false;
  aborter = new AbortController();
  show("progress");
  $("progTitle").textContent = t("prog.loading"); $("progBar").style.width = "0%"; $("progSub").textContent = "";
  let games;
  try { games = await getGames(m => { if (!cancelled) $("progSub").textContent = m; }, aborter.signal); }
  catch (e){ show("home"); if (!cancelled) $("err").textContent = e.message || String(e); return; }
  if (cancelled){ show("home"); return; }
  const losses = games.filter(g => g.res === "L");
  if (!losses.length){ show("home"); $("err").textContent = t("err.noLoss"); return; }
  const prev = readCache(user);
  const [d1, d2] = QUALITY[$("quality").value] || QUALITY.normal;
  // analyzed: {gameKey: [generator, depth]}. A game is analysed again by a newer generator or at a
  // deeper quality, never at a shallower one.
  const an = prev ? { ...prev.analyzed } : {};
  const current = k => !!an[k] && an[k][0] === GEN && an[k][1] >= d2;
  let puzzles = prev ? prev.puzzles.slice() : [];
  const seen = new Set();
  const todo = losses.filter(g => {
    const k = gameKey(g);
    if (seen.has(k) || current(k)) return false;
    seen.add(k); return true;
  });
  const g0 = games[0];
  const display = g0 ? (g0.me === "w" ? g0.white : g0.black) || user : user;
  USER = display;
  store = cleanProgress(prev && prev.progress);
  CACHE = { user: display, puzzles, analyzed: an, games: games.map(g => ({k: gameKey(g), ts: g.ts, res: g.res})), progress: store, at: Date.now() };
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
    const k = gameKey(g);
    try {
      await engine.newGame();
      let from = 0, p = null;
      for (;;){
        const d = await findDecisiveMove(engine, g, d1, () => cancelled, from);
        if (!d || cancelled) break;
        const cand = await buildPuzzle(engine, g, d, d2);
        if (cand.steps.length){ p = cand; break; }
        from = d.next; // the deeper search did not confirm this move: look for the next candidate
      }
      if (cancelled && !p) break; // unfinished: leave the game for the next run
      // replace what an older run stored for this game, even when this run finds no puzzle
      const mine = x => x.id === k || (!!g.link && x.id === g.link) || (!!g.legacy && x.id === g.legacy) || (g.ts > 0 && x.id === `${g.ts}-${x.ply}`);
      const old = puzzles.filter(mine);
      puzzles = puzzles.filter(x => !mine(x));
      if (p){ p.ok = 1; p.tg = 2; puzzles.push(p); } // built from legal moves, tagged by this version
      for (const o of old){
        if (!p || o.id !== p.id) removedIds.add(o.id);
        // Progress is about the position and its answer, not the list of alternatives: the habit stays
        // while the position and the move played are the same, the rest while the first answer is too.
        const samePos = !!p && p.fen === o.fen && p.played_uci === o.played_uci;
        const keep = !samePos ? [] : sameMove(p.steps[0].best, o.steps[0].best) ? ["done", "clean", "habit", "miss"] : ["habit"];
        const drop = new Set();
        for (const m of ["done", "clean", "habit", "miss"]){
          const v = store[m][o.id];
          if (p && o.id === p.id && keep.includes(m)) continue;
          delete store[m][o.id]; drop.add(m);
          if (v && keep.includes(m)) store[m][p.id] = v; // same game under a new id
        }
        if (drop.size) resets.set(o.id, drop);
      }
      an[k] = [GEN, d2];
    } catch (e){
      if (cancelled || (e && e.cancelled)) break;
      console.warn("skip game", g.link, e);
      if (e && e.badPosition){
        // Stockfish refused this game's start position: skip the game and go on with a new engine
        an[k] = [GEN, d2];
        try { engine = new Engine(); await engine.ready; }
        catch (_){ engine = null; died = true; break; }
      } else if (engine && engine.dead){ died = true; break; }
    }
    puzzles.sort((a, b) => b.date.localeCompare(a.date));
    CACHE.puzzles = puzzles; writeCache();
  }
  $("progBar").style.width = "100%";
  CACHE.puzzles = puzzles;
  writeCache(); // also stores this run's game window when nothing new was analysed
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
  run(user, (onProgress, signal) => fetchChessCom(user, { timeClasses: tcs, wantLosses: want, onProgress, signal }).then(gs => {
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
  try { text = await readPgnText(f, user); }
  catch (_){ $("err").textContent = t("err.pgnRead"); e.target.value = ""; return; }
  e.target.value = "";
  const want = +$("nLoss").value;
  run(user, async () => {
    // let the progress screen paint before the (synchronous) parse of a big file
    await new Promise(r => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 100); });
    const gs = parsePgnFile(text, user, want);
    if (gs.unreadable && !gs.some(g => g.res === "L")) throw new Error(t("err.pgnUnreadable", {n: gs.unreadable}));
    if (!gs.length) throw new Error(t("err.pgnNone"));
    return gs;
  });
});

// PGN files are not always UTF-8: the PGN standard says ISO 8859-1, and desktop databases still write
// Windows-1252 or a local code page such as CP949. Pick the first decoding in which the name shows up.
async function readPgnText(file, user){
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder("utf-16be").decode(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch(_) {}
  const names = s => [...s.matchAll(/\[\s*(?:White|Black)\s+"([^"]*)"/g)].map(m => m[1].trim().toLowerCase());
  for (const enc of ["windows-1252", "euc-kr", "windows-1251", "windows-1250", "shift_jis", "gbk", "utf-8"]){
    try { const s = new TextDecoder(enc).decode(bytes); if (names(s).includes(user)) return s; } catch(_) {}
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

/* ---------- report ---------- */
function pct(a, b){ return b ? Math.round(100 * a / b) + "%" : "-"; }
function renderReport(){
  const r = REPORT; if (!r) return;
  const tt = r.total;
  const rules = [];
  if (r.after2.n < 4) rules.push(t("rep.tiltFew", {n: r.after2.n}));
  else if (r.after2.L / r.after2.n > r.fresh.L / Math.max(r.fresh.n, 1) + 0.1)
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
    if (!n && name !== "안 푼 것" && name !== filter) return;
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
    b.onclick = () => { pos = k; load(); toBoard(); };
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
  closePromo();
  drag = null; clearGhosts(); // a gesture never outlives its puzzle
  if (!view.length){
    st = null;
    $("board").innerHTML = ""; $("explain").classList.remove("show"); $("count").textContent = "0 / 0";
    if (PUZ.length) setTop("ok", t("pz.allDone"), t("pz.allDoneSub"));
    else setTop("ok", t("pz.none"), t("pz.noneSub"));
    msg(""); renderSide(); return;
  }
  const idx = view[pos], p = PUZ[idx];
  let game;
  // a stored puzzle that no longer loads (hand-edited storage) is dropped instead of breaking the page
  try { game = new Chess(p.fen); }
  catch(_) { PUZ.splice(idx, 1); removedIds.add(p.id); rebuildView(); return load(); }
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
  const cancelDrag = () => { drag = null; clearGhosts(); if (st){ st.sel = null; draw(); } };
  bd.addEventListener("pointerdown", e => {
    // another finger joined (pinch, resting thumb): abort the gesture, never start one
    if (e.isPrimary === false){ e.preventDefault(); if (drag) cancelDrag(); return; }
    if (!st || st.done || st.busy) return;
    if (e.button !== undefined && e.button > 0) return;
    const sq = sqAt(e.clientX, e.clientY); if (!sq) return;
    e.preventDefault();
    clearGhosts();
    const pc = st.game.get(sq);
    drag = {st, type: e.pointerType, from: sq, own: !!(pc && pc.color === st.p.me), sx: e.clientX, sy: e.clientY, moved: false, ghost: null, over: null, id: e.pointerId};
    try { bd.setPointerCapture(e.pointerId); } catch(_) {}
  });
  bd.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    // right or middle button pressed mid-drag, or the release was lost: cancel the drag
    if (e.pointerType === "mouse" && e.buttons !== 1){ try { bd.releasePointerCapture(e.pointerId); } catch(_) {} cancelDrag(); return; }
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
    if (cancel || d.st !== st || st.done || st.busy){ draw(); return; }
    if (d.moved){
      const to = sqAt(e.clientX, e.clientY);
      if (to && to !== d.from) tryMove(d.from, to); else draw();
    } else clickSq(d.from);
  };
  bd.addEventListener("pointerup", e => end(e, false));
  bd.addEventListener("pointercancel", e => end(e, true));
  bd.addEventListener("lostpointercapture", e => { if (drag && e.pointerId === drag.id) end(e, true); });
  // a right-click mid-drag cancels it; on touch screens contextmenu is just a long press, so it does not
  bd.addEventListener("contextmenu", e => { if (drag && drag.type === "mouse"){ e.preventDefault(); cancelDrag(); } });
}
// King dropped or clicked onto its own castling rook (Lichess's default, Chess.com accepts it too):
// the king's two-square destination that chess.js and Stockfish use, or null.
function castleTo(from, to){
  const k = st.game.get(from), r = st.game.get(to);
  if (!k || k.type !== "k" || !r || r.type !== "r" || r.color !== k.color || from[1] !== to[1]) return null;
  const side = to[0] === "h" ? "k" : to[0] === "a" ? "q" : null;
  const m = side && st.game.moves({square: from, verbose: true}).find(x => x.flags.includes(side));
  return m ? m.to : null;
}
function clickSq(sq){
  if (st.done || st.busy) return;
  const pc = st.game.get(sq);
  if (st.sel && st.sel !== sq && (castleTo(st.sel, sq) || !(pc && pc.color === st.p.me))){ tryMove(st.sel, sq); return; }
  if (pc && pc.color === st.p.me){ st.sel = st.sel === sq ? null : sq; draw(); return; }
  st.sel = null; draw();
}

function tryMove(from, to){
  to = castleTo(from, to) || to;
  const legal = st.game.moves({square: from, verbose: true}).filter(m => m.to === to);
  st.sel = null;
  if (!legal.length){ draw(); return; }
  if (legal.some(m => m.promotion)){ askPromo(from, to); return; }
  attempt(from + to);
}

function closePromo(){ const pr = $("promo"); pr.classList.remove("show"); pr.innerHTML = ""; }
function askPromo(from, to){
  const pr = $("promo"); pr.innerHTML = "";
  const cur = st, step0 = st.step, fen0 = st.game.fen();
  // On touch screens the browser fires a click for the very tap that opened the picker, right where a
  // piece now sits. React only to a press that started on the picker.
  let armed = false;
  pr.onpointerdown = () => { armed = true; };
  const flip = st.p.me === "b";
  const fi = FILES.indexOf(to[0]);
  const col = document.createElement("div"); col.className = "col";
  col.style.left = ((flip ? 7 - fi : fi) * 12.5) + "%"; col.style.top = "0";
  ["q","n","r","b"].forEach(k => {
    const c = document.createElement("div");
    c.style.backgroundImage = `url("${PIECE[st.p.me + k]}")`;
    c.onclick = e => {
      e.stopPropagation(); if (!armed) return; closePromo();
      if (st === cur && !st.done && !st.busy && st.step === step0 && st.game.fen() === fen0) attempt(from + to + k);
    };
    col.appendChild(c);
  });
  pr.appendChild(col);
  pr.onclick = () => { if (!armed) return; closePromo(); draw(); };
  pr.classList.add("show");
}

/* ---------- puzzle logic ---------- */
function play(uci){
  const m = st.game.move({from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || "q"});
  st.last = uci.slice(0,4); return m;
}

function attempt(uci){
  if (!st || st.done || st.busy){ draw(); return; }
  const p = st.p, step = p.steps[st.step], cur = st;
  const real = step.accept.find(a => sameMove(a, uci));
  const ok = !!real;
  const isPlayed = st.step === 0 && sameMove(p.played_uci, uci);
  if (!ok){
    st.wrongs++; markMiss(p.id);
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
  // the stored reply and later steps follow the best move only: another good move ends the puzzle here
  if (st.step >= p.steps.length || !isBest){ finish(true); return; }
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
  const first = st.wrongs === 0 && st.hint === 0 && !store.miss[p.id];
  if (solved && !st.usedAnswer){
    store.done[p.id] = 1;
    if (first) store.clean[p.id] = 1;
    save();
  }
  if (solved && !st.usedAnswer){
    setTop("ok", first ? t("pz.clean") : t("pz.solved"), t("pz.solvedSub"));
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
function evalTxt(v){
  if (Math.abs(v) >= 90000) return v > 0 ? t("ev.mate") : t("ev.mated");
  const x = Math.round(v / 10) / 10; // avoid "-0.0"
  return x === 0 ? "0.0" : (x > 0 ? "+" : "") + x.toFixed(1);
}
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
  st.hint++; markMiss(st.p.id); // st.hint is the running total; the level starts over at each step
  if (st.hintStep !== st.step){ st.hintStep = st.step; st.hintLvl = 0; }
  st.hintLvl++;
  st.hintSq = st.hintLvl === 1 ? [best.slice(0,2)] : [best.slice(0,2), best.slice(2,4)];
  const promo = st.hintLvl > 1 && best[4] ? " " + t("pz.hintPromo", {p: t("pc." + best[4])}) : "";
  msg(st.hintLvl === 1 ? t("pz.hint1") : t("pz.hint2") + promo);
  draw();
};
$("showBtn").onclick = () => {
  if (!st || st.done || st.busy) return;
  closePromo(); markMiss(st.p.id);
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
  closePromo();
  if (!st.done) markMiss(p.id); // its explanation shows the solution line
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
// on phones the panel sits below the board: bring the new board back into view
function toBoard(){ if (innerWidth <= 900) $("puzzleView").scrollIntoView({ behavior: "smooth", block: "start" }); }
$("retryBtn").onclick = () => { load(); toBoard(); };
$("prevBtn").onclick = () => { if (!view.length) return; pos = (pos - 1 + view.length) % view.length; load(); toBoard(); };
$("nextBtn").onclick = () => {
  if (!view.length) return;
  if (filter === "안 푼 것"){ const cur = view[pos]; rebuildView(); const k = view.findIndex(i => i > cur); pos = k >= 0 ? k : 0; }
  else pos = (pos + 1) % view.length;
  load(); toBoard();
};
document.addEventListener("keydown", e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || $("puzzleView").classList.contains("hidden")) return;
  if (e.key === "ArrowRight") $("nextBtn").click();
  if (e.key === "ArrowLeft") $("prevBtn").click();
});


bindBoard();
renderSaved();
try { const last = savedUsers()[0]; if (last) $("user").value = last; } catch(_) {}
