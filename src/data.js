// 체스 오답노트 — Copyright (C) 2026 Katherine Nahm
// SPDX-License-Identifier: GPL-3.0-or-later
// Loading games: Chess.com public API (directly, or through the /api/chesscom proxy when
// the browser blocks a direct request), or a PGN file the user uploads.
import { Chess } from "../vendor/chess.js";
import { t } from "./i18n.js";

// Accepts "MagnusFan", "@MagnusFan", " magnusfan ", or a profile URL like
// https://www.chess.com/member/magnusfan (also localized ones such as chess.com/ko/member/...).
// Returns the lower-case username or null.
export function normalizeUser(input) {
  let s = String(input || "").trim();
  const m = s.match(/chess\.com\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,4})?\/)?(?:member|stats\/[a-z]+(?:\/[a-z]+)?|games\/archive|profile)\/([A-Za-z0-9_-]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@+/, "").replace(/[\/?#].*$/, "").trim().toLowerCase();
  return /^[a-z0-9_-]{2,40}$/.test(s) ? s : null;
}

const LOSS = new Set(["checkmated", "resigned", "timeout", "abandoned", "lose", "bughousepartnerlose"]);
const DRAW = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);

/* ---------- Chess.com ---------- */
const DIRECT_WAIT = 10000, PROXY_WAIT = 30000; // ms to wait for an answer
const RETRY_WAITS = [2000, 8000]; // pauses before the 2nd and 3rd try of a 429 / 5xx
let directDown = false; // the direct request failed at the network level (blocked): use the proxy only

const cancelError = () => Object.assign(new Error("cancelled"), { cancelled: true });
const httpError = (s) => Object.assign(new Error(t("err.http", { s })), { status: s, retry: s === 429 || s >= 500 });
const notFound = () => Object.assign(new Error("not found"), { notFound: true });
// Chess.com answers 404 both for a missing player ({"message":"User \"x\" not found."}) and, during
// incidents, for players that exist ({"code":0,"message":"An internal error has occurred..."}).
const missingUser = (body) => /^User\b.*\bnot found/i.test(String((body && body.message) || ""));

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(cancelError());
    const id = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(id); reject(cancelError()); }, { once: true });
  });
}

// One request, answer included, within `ms`; `signal` (Cancel) can stop it at any time.
async function request(url, ms, signal) {
  if (signal && signal.aborted) throw cancelError();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const text = await r.text();
    const isJson = (r.headers.get("content-type") || "").includes("json");
    let body = null;
    if (isJson) try { body = JSON.parse(text); } catch (_) {}
    return { status: r.status, ok: r.ok, isJson, body };
  } catch (e) {
    if (signal && signal.aborted) throw cancelError();
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

async function getJSONOnce(path, signal) {
  let status = 0; // what Chess.com answered on the direct request; 0 = no readable answer
  let timedOut = false;
  if (!directDown) {
    try {
      const r = await request("https://api.chess.com" + path, DIRECT_WAIT, signal);
      if (r.ok && r.body) return r.body;
      if (r.status === 404 && missingUser(r.body)) throw notFound();
      status = r.status;
    } catch (e) {
      if (e.notFound || e.cancelled) throw e;
      if (e.name !== "AbortError") directDown = true; // blocked, not slow
      else timedOut = true;
    }
  }
  // Fall back to our own proxy (works when deployed on Vercel).
  let r;
  try {
    r = await request("/api/chesscom?path=" + encodeURIComponent(path), PROXY_WAIT, signal);
  } catch (e) {
    if (e.cancelled) throw e;
    throw status ? httpError(status) : new Error(t("err.offline"));
  }
  if (r.ok && r.body) {
    if (timedOut) directDown = true; // the proxy answers while the direct route hangs: stop waiting on it
    return r.body;
  }
  if (r.status === 404 && missingUser(r.body)) throw notFound();
  // not JSON: no proxy here (for example a local static server)
  if (!r.isJson) throw status ? httpError(status) : new Error(t("err.offline"));
  throw httpError(r.status);
}

async function getJSON(path, signal) {
  for (let i = 0; ; i++) {
    try {
      return await getJSONOnce(path, signal);
    } catch (e) {
      if (!e.retry || i >= RETRY_WAITS.length) throw e;
      await sleep(RETRY_WAITS[i], signal);
    }
  }
}

// Returns games newest first: {white, black, me, res, pgn, ts, link, timeClass, ...}
export async function fetchChessCom(username, { timeClasses, wantLosses, onProgress, signal }) {
  const user = normalizeUser(username);
  if (!user) throw new Error(t("err.badId"));
  directDown = false; // try the direct route again on each run: an earlier failure may have been passing
  let archives;
  try {
    archives = (await getJSON(`/pub/player/${encodeURIComponent(user)}/games/archives`, signal)).archives || [];
  } catch (e) {
    if (e.notFound) throw new Error(t("err.notFound", { u: username }));
    throw e;
  }
  if (!archives.length) throw new Error(t("err.noGames"));
  const games = [];
  let losses = 0, monthErr = null;
  for (let i = archives.length - 1; i >= 0 && losses < wantLosses && i >= archives.length - 24; i--) {
    let path;
    try { path = new URL(archives[i]).pathname; } catch (_) { continue; }
    const [y, m] = path.split("/").slice(-2);
    onProgress && onProgress(t("prog.month", { y, m }));
    let month = [];
    try {
      month = (await getJSON(path, signal)).games || [];
    } catch (e) {
      // a month Chess.com still refuses after the retries is skipped; no answer at all stops here
      if (e.cancelled || !e.status) throw e;
      console.warn("skip month", path, e);
      monthErr = monthErr || e;
      continue;
    }
    month.sort((a, b) => b.end_time - a.end_time);
    for (const g of month) {
      if (g.rules !== "chess" || !g.pgn || !g.white || !g.black) continue;
      if (timeClasses && !timeClasses.includes(g.time_class)) continue;
      const meWhite = String(g.white.username || "").toLowerCase() === user;
      if (!meWhite && String(g.black.username || "").toLowerCase() !== user) continue;
      const mine = meWhite ? g.white.result : g.black.result;
      const res = mine === "win" ? "W" : DRAW.has(mine) ? "D" : LOSS.has(mine) ? "L" : null;
      if (!res) continue;
      games.push({
        white: g.white.username,
        black: g.black.username,
        me: meWhite ? "w" : "b",
        res,
        pgn: g.pgn,
        ts: g.end_time * 1000,
        link: g.url,
        timeClass: g.time_class,
        myElo: meWhite ? g.white.rating : g.black.rating,
        oppElo: meWhite ? g.black.rating : g.white.rating,
      });
      if (res === "L") losses++;
    }
  }
  if (!games.length && monthErr) throw monthErr;
  games.sort((a, b) => b.ts - a.ts);
  return games;
}

/* ---------- PGN files ---------- */
// Short stable hash (FNV-1a) for games that have no game URL to use as their id.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const RESULTS = new Set(["1-0", "0-1", "1/2-1/2"]);
// Variant names that mean ordinary chess. Lichess writes [Variant "Standard"] on normal games and
// "From Position" on set-up starts. Three-check, Atomic, Chess960... replay as standard chess without
// an error, but the positions and the engine's verdicts would be wrong (the Chess.com path checks rules).
const STANDARD = new Set(["standard", "chess", "classical", "normal", "from position"]);
const TAG_LINE = /^[ \t]*\[[A-Za-z0-9_]+[ \t]+"/;
const TAG_AT = /^\s*\[\s*([A-Za-z0-9_]+)\s*"((?:[^"\\\r\n]|\\.)*)"\s*\]/;
const isHttp = (s) => /^https?:\/\//i.test(s || "");

// One chunk per game. A game starts at a tag line whose previous non-blank line is not a tag line;
// braces are tracked so a "[" inside a multi-line comment never starts a game.
function splitPgnGames(text) {
  const lines = text
    .replace(/\uFEFF/g, "") // BOMs, also from concatenated files
    .replace(/\r\n?/g, "\n")
    .replace(/(1-0|0-1|1\/2-1\/2|\*)[ \t]*(?=\[[A-Za-z0-9_]+[ \t]+")/g, "$1\n") // "...0-1[Event"
    .split("\n");
  const chunks = [];
  let cur = [], prevTag = false, inBrace = false;
  for (const line of lines) {
    if (line[0] === "%") continue; // PGN escape line
    const isTag = !inBrace && TAG_LINE.test(line);
    if (isTag && !prevTag && cur.some((l) => l.trim())) { chunks.push(cur.join("\n")); cur = []; }
    cur.push(line);
    if (line.trim()) prevTag = isTag;
    if (!isTag) for (const ch of line) {
      if (inBrace) { if (ch === "}") inBrace = false; }
      else if (ch === "{") inBrace = true;
      else if (ch === ";") break;
    }
  }
  if (cur.some((l) => l.trim())) chunks.push(cur.join("\n"));
  return chunks;
}

// Tag pairs as written (underscores in names and \" escapes allowed, which chess.js rejects).
function splitTags(chunk) {
  const h = {};
  let rest = chunk;
  for (let m; (m = TAG_AT.exec(rest)); rest = rest.slice(m[0].length)) h[m[1]] = m[2].replace(/\\(["\\])/g, "$1");
  return { h, movetext: rest };
}

// Mainline only: no comments, variations, NAGs or "e.p.", castling with letters, figurines as letters.
function mainline(movetext) {
  let out = "", depth = 0;
  for (let i = 0; i < movetext.length; i++) {
    const ch = movetext[i];
    if (ch === "{") { const j = movetext.indexOf("}", i); if (j < 0) break; i = j; out += " "; }
    else if (ch === ";") { const j = movetext.indexOf("\n", i); if (j < 0) break; i = j; out += "\n"; }
    else if (ch === "(") depth++;
    else if (ch === ")") { if (depth) depth--; }
    else if (!depth) out += ch;
  }
  return out
    .replace(/\$\d+/g, " ")
    .replace(/\s*e\.p\./g, "")
    .replace(/½-½/g, "1/2-1/2")
    .replace(/\b0-0-0\b/g, "O-O-O")
    .replace(/\b0-0\b(?!-)/g, "O-O")
    .replace(/[♔♚]/g, "K").replace(/[♕♛]/g, "Q").replace(/[♖♜]/g, "R").replace(/[♗♝]/g, "B").replace(/[♘♞]/g, "N")
    .replace(/[♙♟]/g, "");
}

// The game in a form chess.js loads: only the start-position tags (chess.js's tag grammar is stricter
// than the PGN standard), then the movetext as written, or its mainline when chess.js rejects that
// (two comments in a row, as in Lichess exports, null moves inside variations, ...).
function loadable(h, movetext) {
  const fenKey = Object.keys(h).find((k) => k.toLowerCase() === "fen");
  const head = fenKey ? `[SetUp "1"]\n[FEN "${h[fenKey]}"]\n\n` : "";
  for (const body of [movetext, mainline(movetext)]) {
    try {
      new Chess().loadPgn(head + body);
      return head + body;
    } catch (_) {}
  }
  return null;
}

function gameRef(h, movetext) {
  if (isHttp(h.Link)) return { link: h.Link, key: h.Link }; // Chess.com: the same id as the API's game URL
  const site = h.Site || "";
  if (/^https?:\/\/(?:www\.)?lichess\.org\//i.test(site)) {
    const id = /^[A-Za-z0-9]{8}$/.test(h.GameId || "") ? h.GameId
      : (site.match(/lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})(?:[\/?#]|$)/i) || [])[1];
    if (id) return { link: "https://lichess.org/" + id, key: "lichess:" + id };
  }
  // no game URL: identify the game by its players, date, result and moves (not by comments or clocks,
  // which differ between exports of the same game)
  const moves = mainline(movetext).replace(/\d+\.(\.\.)?/g, " ").replace(/\s+/g, " ").trim();
  const id = [h.White, h.Black, h.UTCDate || h.Date, h.UTCTime || h.StartTime, moves].join("|");
  return { link: isHttp(site) && /^https?:\/\/[^/]+\/./.test(site) ? site : "", key: "pgn:" + hash(id) };
}

// Games of `username` in the file, newest first, up to the `want`-th loss chess.js can read. Only those
// losses are replayed (a full replay takes milliseconds per game and big exports hold thousands).
// The array's `unreadable` property counts this user's losses that could not be read.
export function parsePgnFile(text, username, want = Infinity) {
  const user = normalizeUser(username) || String(username).trim().toLowerCase();
  const games = [];
  for (const chunk of splitPgnGames(text)) {
    if (!chunk.trim()) continue;
    const { h, movetext } = splitTags(chunk);
    if (h.Variant && !STANDARD.has(h.Variant.trim().toLowerCase())) continue;
    const w = (h.White || "").trim().toLowerCase(), b = (h.Black || "").trim().toLowerCase();
    if (w !== user && b !== user) continue;
    const me = w === user ? "w" : "b";
    // a valid declared result wins; the movetext's termination marker only fills a missing or "*" tag
    const r = RESULTS.has(h.Result) ? h.Result : (mainline(movetext).trim().match(/(1-0|0-1|1\/2-1\/2|\*)$/) || [])[1];
    const res = r === "1/2-1/2" ? "D" : r === "1-0" ? (me === "w" ? "W" : "L") : r === "0-1" ? (me === "b" ? "W" : "L") : null;
    if (!res) continue; // unfinished or unknown result ("*")
    // unknown or partial dates ("????.??.??", "2024.??.??") stay unknown: ts 0
    const dm = (h.UTCDate || h.Date || "").match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
    const tm = (h.UTCTime || h.StartTime || "").match(/^(\d{2}):(\d{2}):(\d{2})$/);
    const ts = (dm && Date.UTC(+dm[1], +dm[2] - 1, +dm[3], tm ? +tm[1] : 0, tm ? +tm[2] : 0, tm ? +tm[3] : 0)) || 0;
    const tc = h.TimeControl || "";
    const base = parseInt(tc, 10);
    const timeClass = tc.includes("/") || tc === "-" ? "daily" : base < 180 ? "bullet" : base < 600 ? "blitz" : "rapid";
    games.push({
      white: h.White, black: h.Black, me, res, ts, h, movetext, chunk,
      day: dm && !tm ? `${dm[1]}.${dm[2]}.${dm[3]}` : "", // no clock time: show the header's date as is
      timeClass,
      myElo: +(me === "w" ? h.WhiteElo : h.BlackElo) || null,
      oppElo: +(me === "w" ? h.BlackElo : h.WhiteElo) || null,
      event: h.Event || "",
    });
  }
  games.sort((a, b) => b.ts - a.ts);
  const out = [];
  let losses = 0, unreadable = 0;
  for (const g of games) {
    if (losses >= want) break;
    if (g.res === "L") {
      g.pgn = loadable(g.h, g.movetext);
      if (!g.pgn) { unreadable++; continue; }
      losses++;
    }
    Object.assign(g, gameRef(g.h, g.movetext));
    // the id earlier builds of this branch gave every PGN game, so their puzzles are recognised
    g.legacy = g.h.Link || "pgn:" + hash(g.chunk.trim());
    delete g.h; delete g.movetext; delete g.chunk;
    out.push(g);
  }
  out.unreadable = unreadable;
  return out;
}
