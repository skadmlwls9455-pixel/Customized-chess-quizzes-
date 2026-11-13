// 체스 오답노트 — Copyright (C) 2026 Katherine Nahm
// SPDX-License-Identifier: GPL-3.0-or-later
// Vercel serverless proxy for the Chess.com public API.
// Only used when the browser cannot reach api.chess.com directly. Restricted to read-only
// player game endpoints so it cannot be used as an open proxy.
const ALLOWED = /^\/pub\/player\/[a-z0-9_-]{1,40}\/games\/(archives|\d{4}\/\d{2})$/i;

export default async function handler(req, res) {
  const path = String(req.query.path || "");
  if (!ALLOWED.test(path)) {
    res.status(400).json({ error: "bad path" });
    return;
  }
  try {
    const r = await fetch("https://api.chess.com" + path, {
      headers: { "User-Agent": "chess-mistake-notes (open source, github.com/skadmlwls9455-pixel/customized-chess-quizzes-)" },
    });
    const body = await r.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, max-age=60");
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: "upstream failed" });
  }
}
