// Stockfish (WASM, lite single-threaded) wrapper.
// Every call returns the final "info" line for each multipv slot, scored from the side to move.

export class Engine {
  constructor(url = "vendor/stockfish-19-lite-single.js") {
    this.worker = new Worker(url);
    this.queue = [];
    this.current = null;
    this.ready = new Promise((resolve) => {
      this._onReady = resolve;
    });
    this.worker.onmessage = (e) => this._line(typeof e.data === "string" ? e.data : String(e.data));
    this.worker.onerror = (e) => {
      if (this.current) this.current.reject(new Error("engine error: " + (e.message || "unknown")));
    };
    this.worker.postMessage("uci");
    this.worker.postMessage("setoption name Hash value 32");
    this.worker.postMessage("isready");
  }

  _line(line) {
    if (line === "readyok" && this._onReady) {
      this._onReady();
      this._onReady = null;
      this._next();
      return;
    }
    const job = this.current;
    if (!job) return;
    if (line.startsWith("info ") && line.includes(" pv ") && line.includes(" score ")) {
      const t = line.split(" ");
      const get = (k) => t[t.indexOf(k) + 1];
      const mpv = t.includes("multipv") ? +get("multipv") : 1;
      const si = t.indexOf("score");
      const kind = t[si + 1];
      const val = +t[si + 2];
      const pv = t.slice(t.indexOf("pv") + 1);
      job.infos[mpv] = { kind, val, pv, depth: +get("depth") };
    } else if (line.startsWith("bestmove")) {
      const best = line.split(" ")[1];
      const infos = Object.keys(job.infos)
        .map(Number)
        .sort((a, b) => a - b)
        .map((k) => job.infos[k]);
      this.current = null;
      job.resolve({ infos, best: best && best !== "(none)" ? best : null });
      this._next();
    }
  }

  _next() {
    if (this.current || this._onReady || !this.queue.length) return;
    const job = (this.current = this.queue.shift());
    this.worker.postMessage(`setoption name MultiPV value ${job.multipv}`);
    this.worker.postMessage(`position fen ${job.fen}`);
    this.worker.postMessage(`go depth ${job.depth}`);
  }

  analyse(fen, depth, multipv = 1) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, depth, multipv, resolve, reject, infos: {} });
      this._next();
    });
  }

  stop() {
    this.queue = [];
    try {
      this.worker.terminate();
    } catch (_) {}
  }
}

// Score of an engine line in centipawns from the side to move. Mates map to +-100000.
export function scoreOf(info) {
  if (!info) return 0;
  if (info.kind === "mate") {
    const m = info.val;
    if (m === 0) return -100000;
    return m > 0 ? 100000 - Math.abs(m) * 100 : -100000 + Math.abs(m) * 100;
  }
  return info.val;
}
