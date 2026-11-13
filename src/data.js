// Loading games: Chess.com public API (directly, or through the /api/chesscom proxy when
// the browser blocks a direct request), or a PGN file the user uploads.
import { Chess } from "../vendor/chess.js";

const LOSS = new Set(["checkmated", "resigned", "timeout", "abandoned", "lose", "bughousepartnerlose"]);
const DRAW = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);

async function getJSON(path) {
  const direct = "https://api.chess.com" + path;
  try {
    const r = await fetch(direct);
    if (r.status === 404) throw Object.assign(new Error("not found"), { notFound: true });
    if (r.ok) return await r.json();
    throw new Error("HTTP " + r.status);
  } catch (e) {
    if (e.notFound) throw e;
    // Fall back to our own proxy (works when deployed on Vercel).
    const r = await fetch("/api/chesscom?path=" + encodeURIComponent(path));
    const isJson = (r.headers.get("content-type") || "").includes("json");
    if (r.status === 404 && isJson) throw Object.assign(new Error("not found"), { notFound: true });
    if (!isJson) throw new Error("Chess.com에 연결하지 못했어. 잠시 뒤에 다시 하거나 PGN 파일을 올려 줘.");
    if (!r.ok) throw new Error("Chess.com에서 기록을 가져오지 못했어 (HTTP " + r.status + ")");
    return await r.json();
  }
}

// Returns games newest first: {white, black, result, pgn, ts, link, timeClass}
export async function fetchChessCom(username, { timeClasses, wantLosses, onProgress }) {
  const user = username.trim().toLowerCase();
  let archives;
  try {
    archives = (await getJSON(`/pub/player/${encodeURIComponent(user)}/games/archives`)).archives || [];
  } catch (e) {
    if (e.notFound) throw new Error(`"${username}" 아이디를 Chess.com에서 찾지 못했어.`);
    throw e;
  }
  if (!archives.length) throw new Error("이 아이디로 둔 게임이 없어.");
  const games = [];
  let losses = 0;
  for (let i = archives.length - 1; i >= 0 && losses < wantLosses && i >= archives.length - 24; i--) {
    const path = new URL(archives[i]).pathname;
    onProgress && onProgress(`${path.split("/").slice(-2).join("년 ")}월 기록 불러오는 중…`);
    const month = (await getJSON(path)).games || [];
    month.sort((a, b) => b.end_time - a.end_time);
    for (const g of month) {
      if (g.rules !== "chess" || !g.pgn) continue;
      if (timeClasses && !timeClasses.includes(g.time_class)) continue;
      const meWhite = g.white.username.toLowerCase() === user;
      const mine = meWhite ? g.white.result : g.black.result;
      const res = mine === "win" ? "W" : DRAW.has(mine) ? "D" : LOSS.has(mine) ? "L" : "L";
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
  games.sort((a, b) => b.ts - a.ts);
  return games;
}

export function parsePgnFile(text, username) {
  const user = username.trim().toLowerCase();
  const chunks = text.replace(/\r/g, "").split(/\n\n(?=\[Event )/);
  const games = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const c = new Chess();
    try {
      c.loadPgn(chunk);
    } catch (_) {
      continue;
    }
    const h = c.getHeaders();
    const w = (h.White || "").toLowerCase(), b = (h.Black || "").toLowerCase();
    if (w !== user && b !== user) continue;
    const me = w === user ? "w" : "b";
    const r = h.Result;
    const res = r === "1/2-1/2" ? "D" : (r === "1-0") === (me === "w") ? "W" : r === "*" ? "D" : "L";
    const d = (h.UTCDate || h.Date || "").replace(/\./g, "-");
    const t = h.UTCTime || h.StartTime || "00:00:00";
    const ts = Date.parse(`${d}T${t}Z`) || 0;
    const tc = h.TimeControl || "";
    const base = parseInt(tc, 10);
    const timeClass = tc.includes("/") || tc === "-" ? "daily" : base < 180 ? "bullet" : base < 600 ? "blitz" : "rapid";
    games.push({
      white: h.White, black: h.Black, me, res, pgn: chunk, ts,
      link: h.Link || "", timeClass,
      myElo: +(me === "w" ? h.WhiteElo : h.BlackElo) || null,
      oppElo: +(me === "w" ? h.BlackElo : h.WhiteElo) || null,
      event: h.Event || "",
    });
  }
  games.sort((a, b) => b.ts - a.ts);
  return games;
}
