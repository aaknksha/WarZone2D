import type { LobbyView, MatchResult, Snapshot } from "../../../shared/protocol.ts";
import { SLOT_CSS } from "../game/palette.ts";
import type { ConnStatus, NetError } from "../network/net.ts";

export const ERROR_TEXT: Record<NetError, string> = {
  ALREADY_IN_ROOM: "You are already in a room.",
  INVALID_CODE: "That doesn't look like a valid room code (5 letters/digits).",
  ROOM_NOT_FOUND: "No match found with that code.",
  ROOM_FULL: "That room is full (4/4 players).",
  MATCH_STARTED: "That match has already started.",
  NOT_IN_ROOM: "You are not in a room.",
  NOT_HOST: "Only the host can start the match.",
  NOT_ENOUGH_PLAYERS: "At least 2 players are needed to start.",
  BAD_STATE: "That action isn't available right now.",
  BAD_PAYLOAD: "Invalid request.",
  SERVER_BUSY: "The server is busy. Try again in a moment.",
  RATE_LIMITED: "Slow down a little.",
  OFFLINE: "Not connected to the server.",
};

export interface UIHandlers {
  onCreate(name: string): void;
  onJoin(name: string, code: string): void;
  onStart(): void;
  onLeaveLobby(): void;
  onBackToMenu(): void;
  onToggleMute(): boolean; // returns new muted state
}

type ScreenName = "menu" | "play" | "lobby" | "results" | "leaderboard" | "history" | "none";
const SCREENS: Exclude<ScreenName, "none">[] = ["menu", "play", "lobby", "results", "leaderboard", "history"];

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // textContent only: player names are untrusted
  return e;
}

interface Chip {
  root: HTMLElement;
  rank: HTMLElement;
  kills: HTMLElement;
  deaths: HTMLElement;
  fill: HTMLElement;
  slot: number;
}

export class UI {
  private h: UIHandlers;
  private chips = new Map<string, Chip>();
  private toastTimer = 0;
  private bannerTimer = 0;
  private order = "";
  private prevAlive = true;
  private deathTotal = 1;
  private killedBy: string | null = null;

  constructor(handlers: UIHandlers) {
    this.h = handlers;
    const name = () => $<HTMLInputElement>("in-name").value.trim();
    const code = () => $<HTMLInputElement>("in-code").value.trim();
    $("btn-play").onclick = () => this.show("play");
    $("btn-leaderboard").onclick = () => void this.openRecords("leaderboard");
    $("btn-history").onclick = () => void this.openRecords("history");
    $("btn-leaderboard-refresh").onclick = () => void this.loadRecords("leaderboard");
    $("btn-history-refresh").onclick = () => void this.loadRecords("history");
    $("btn-leaderboard-back").onclick = () => this.show("menu");
    $("btn-history-back").onclick = () => this.show("menu");
    $("btn-play-back").onclick = () => this.show("menu");
    $("btn-controls").onclick = () => this.showControls(true);
    $("btn-controls-close").onclick = () => this.showControls(false);
    $("btn-create").onclick = () => handlers.onCreate(name());
    $("btn-join").onclick = () => handlers.onJoin(name(), code());
    $("in-code").addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") handlers.onJoin(name(), code());
    });
    $("btn-start").onclick = () => handlers.onStart();
    $("btn-lobby-leave").onclick = () => handlers.onLeaveLobby();
    $("btn-res-menu").onclick = () => handlers.onBackToMenu();
    $("btn-copy").onclick = () => void this.copyCode();
    const mute = $("btn-mute");
    mute.onclick = () => this.setMuted(handlers.onToggleMute());
  }

  // ---------- screens ----------
  show(name: ScreenName): void {
    for (const s of SCREENS) $(`screen-${s}`).classList.toggle("hidden", s !== name);
    $("play-error").textContent = "";
  }
  private recordsRequest = 0;

  private async openRecords(kind: "leaderboard" | "history"): Promise<void> {
    this.show(kind);
    await this.loadRecords(kind);
  }

  private async loadRecords(kind: "leaderboard" | "history"): Promise<void> {
    const request = ++this.recordsRequest;
    const status = $(kind + "-status");
    const body = $(kind + "-body");
    status.textContent = "Loading…";
    body.replaceChildren();
    try {
      const path = kind === "leaderboard" ? "/api/leaderboard" : "/api/matches";
      const response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const rows: unknown = await response.json();
      if (request !== this.recordsRequest) return;
      if (!Array.isArray(rows)) throw new Error("Unexpected response format");
      if (rows.length === 0) {
        status.textContent = kind === "leaderboard" ? "No rankings yet. Finish a match to appear here." : "No match history yet. Complete a match to see results.";
        return;
      }
      status.textContent = kind === "leaderboard" ? `TOP ${rows.length} PLAYERS` : `${rows.length} RECENT MATCHES`;
      for (const [index, record] of rows.entries()) {
        const row = record as Record<string, unknown>;
        const tr = el("tr");
        const cells = kind === "leaderboard"
          ? [String(index + 1), String(row.display_name ?? "Unknown"), String(row.wins ?? 0), String(row.matches ?? 0), String(row.total_score ?? 0), String(row.total_deaths ?? 0)]
          : [this.formatDate(row.ended_at), String(row.room_code ?? "—"), String(row.winner_name ?? "—"), row.draw === true ? "DRAW" : String(row.reason ?? "COMPLETE").toUpperCase()];
        for (const value of cells) tr.append(el("td", "", value));
        body.append(tr);
      }
    } catch (error) {
      if (request !== this.recordsRequest) return;
      status.textContent = `Unable to load ${kind === "leaderboard" ? "leaderboard" : "history"}. Check that the API is running, then press REFRESH.`;
      console.error("Records request failed:", error);
    }
  }

  private formatDate(value: unknown): string {
    if (typeof value !== "string") return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  }

  showControls(open: boolean): void {
    $("screen-controls").classList.toggle("hidden", !open);
  }
  setConn(s: ConnStatus): void {
    const c = $("conn");
    c.className = `conn ${s}`;
    c.querySelector("span")!.textContent = s === "online" ? "online" : s === "offline" ? "offline — retrying…" : "connecting…";
  }
  setMuted(muted: boolean): void {
    $("btn-mute").textContent = muted ? "SND OFF" : "SND ON";
  }
  setBusy(busy: boolean): void {
    for (const id of ["btn-create", "btn-join", "btn-start"]) $<HTMLButtonElement>(id).disabled = busy;
  }
  setPlayError(msg: string): void {
    $("play-error").textContent = msg;
  }
  setLobbyError(msg: string): void {
    $("lobby-error").textContent = msg;
  }
  toast(msg: string, ms = 3200): void {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add("hidden"), ms);
  }

  // ---------- lobby ----------
  renderLobby(l: LobbyView, you: string): void {
    $("lobby-code").textContent = l.code;
    $("lobby-count").textContent = `PLAYERS ${l.players.length}/${l.max}`;
    $("lobby-error").textContent = "";
    const list = $("lobby-players");
    list.replaceChildren();
    l.players.forEach((p, i) => {
      const li = el("li");
      const sw = el("span", "sw");
      sw.style.background = SLOT_CSS[i] ?? "#fff";
      li.append(sw, el("span", "nm", p.name));
      if (p.id === you) li.append(el("span", "you", "YOU"));
      if (p.isHost) li.append(el("span", "badge", "HOST"));
      list.append(li);
    });
    for (let i = l.players.length; i < l.max; i++) list.append(el("li", "empty", "waiting for player…"));
    const isHost = l.hostId === you;
    const enough = l.players.length >= l.min;
    $<HTMLButtonElement>("btn-start").disabled = !(isHost && enough);
    $("lobby-hint").textContent = !enough
      ? `Waiting for players… need at least ${l.min} to start. Share the room code.`
      : isHost
        ? "Ready. Start whenever you like."
        : "Waiting for the host to start the match…";
  }

  private async copyCode(): Promise<void> {
    const code = $("lobby-code").textContent ?? "";
    try {
      await navigator.clipboard.writeText(code);
      this.toast("Room code copied");
    } catch {
      const ta = el("textarea");
      ta.value = code;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      this.toast(ok ? "Room code copied" : "Copy failed — select the code manually");
    }
  }

  // ---------- HUD ----------
  initHud(s: Snapshot, you: string): void {
    const board = $("hud-board");
    board.replaceChildren();
    this.chips.clear();
    this.order = "";
    this.prevAlive = true;
    this.killedBy = null;
    $("game").classList.remove("dead");
    $("hud-dead").classList.add("hidden");
    $("hud-feed").replaceChildren();
    s.players.forEach((p, i) => {
      const root = el("div", p.id === you ? "chip me" : "chip");
      root.style.borderLeft = `5px solid ${SLOT_CSS[i] ?? "#fff"}`;
      const row = el("div", "row");
      const rank = el("span", "rk", String(i + 1));
      const kills = el("b", "k", "0");
      const deaths = el("i", "d", "0");
      const kd = el("span", "kd");
      kd.append(kills, document.createTextNode(" / "), deaths);
      row.append(rank, el("span", "nm", p.name), kd);
      const bar = el("div", "bar");
      const fill = el("div");
      fill.style.background = SLOT_CSS[i] ?? "#fff";
      bar.append(fill);
      root.append(row, bar);
      this.chips.set(p.id, { root, rank, kills, deaths, fill, slot: i });
    });
    this.updateHud(s, you);
  }

  showHud(on: boolean): void {
    $("hud").classList.toggle("hidden", !on);
    if (!on) {
      $("game").classList.remove("dead");
      $("banner").classList.add("hidden");
    }
  }

  /** Called by main when you are eliminated, so the death screen can name your killer. */
  setKilledBy(name: string | null): void {
    this.killedBy = name;
  }

  updateHud(s: Snapshot, you: string): void {
    const secs = Math.ceil(s.remainingMs / 1000);
    const timer = $("hud-timer");
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    timer.classList.toggle("low", secs <= 30 && s.countdownMs === 0);

    // live leaderboard: most kills first (fewer deaths break ties, then lobby order)
    const ranked = [...s.players].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    const key = ranked.map((p) => p.id).join(",");
    if (key !== this.order) {
      this.order = key;
      $("hud-board").replaceChildren(...ranked.map((p) => this.chips.get(p.id)?.root).filter((n): n is HTMLElement => !!n));
    }
    let rank = 0;
    ranked.forEach((p, i) => {
      if (i === 0 || p.score !== ranked[i - 1]!.score) rank = i + 1; // equal kills share a rank
      const c = this.chips.get(p.id);
      if (!c) return;
      c.rank.textContent = String(rank);
      c.kills.textContent = String(p.score);
      c.deaths.textContent = String(p.deaths);
      c.fill.style.width = `${Math.max(0, p.health)}%`;
      c.root.classList.toggle("out", !p.alive && !p.disconnected);
      c.root.classList.toggle("gone", p.disconnected);
    });

    const me = s.players.find((p) => p.id === you);
    if (!me) return;
    const fill = $("hud-hp");
    fill.style.width = `${Math.max(0, me.health)}%`;
    fill.style.background = me.health > 60 ? "#7cff6b" : me.health > 30 ? "#ffb000" : "#ff4a3a";
    $("hud-hp-text").textContent = String(Math.max(0, me.health));
    $("hud-kills").textContent = String(me.score);
    $("hud-streak").textContent = me.streak >= 2 ? `STREAK x${me.streak}` : "";

    // death screen: screen goes grey and a respawn timer counts down
    const dead = !me.alive;
    $("game").classList.toggle("dead", dead);
    const box = $("hud-dead");
    box.classList.toggle("hidden", !dead);
    if (dead) {
      if (this.prevAlive) this.deathTotal = Math.max(1, me.respawnInMs);
      const waiting = me.respawnInMs > 0;
      $("d-by").textContent = this.killedBy ? `Eliminated by ${this.killedBy}` : "";
      $("d-timer").textContent = waiting ? `RESPAWN IN ${(me.respawnInMs / 1000).toFixed(1)}s` : "SPECTATING";
      $("d-bar").classList.toggle("hidden", !waiting);
      $("d-fill").style.width = `${Math.min(100, Math.max(0, (1 - me.respawnInMs / this.deathTotal) * 100))}%`;
    }
    this.prevAlive = me.alive;
  }

  /** Big centre-screen text: countdown numbers, FIGHT!, RESPAWNED. */
  banner(text: string, kind: "count" | "fight" | "small" = "count", ms = 1100): void {
    const b = $("banner");
    b.textContent = text;
    b.className = `banner ${kind}`;
    void b.offsetWidth; // restart the CSS animation
    b.classList.add("pop");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.add("hidden"), ms);
  }

  addKill(
    killer: { name: string; slot: number } | null,
    victim: { name: string; slot: number },
    reason: "killed" | "disconnect",
    streak = 0,
  ): void {
    const feed = $("hud-feed");
    const row = el("div");
    const colored = (t: string, slot: number) => {
      const s = el("span", undefined, t);
      s.style.color = SLOT_CSS[slot] ?? "#fff";
      return s;
    };
    if (reason === "disconnect" || !killer) row.append(colored(victim.name, victim.slot), el("span", undefined, " left the battle"));
    else {
      row.append(colored(killer.name, killer.slot), el("span", undefined, " ✕ "), colored(victim.name, victim.slot));
      if (streak >= 3) row.append(el("span", "streak", `  ${streak} KILL STREAK`));
    }
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastElementChild?.remove();
    window.setTimeout(() => row.remove(), 6000);
  }

  // ---------- results ----------
  showResults(r: MatchResult, you: string, slots: Map<string, number>): void {
    const title = $("res-title");
    title.className = "res-title";
    if (r.draw) {
      title.textContent = "DRAW";
      title.classList.add("draw");
    } else if (r.winnerId === you) {
      title.textContent = "VICTORY";
      title.classList.add("win");
    } else {
      title.textContent = "DEFEAT";
      title.classList.add("lose");
    }
    const nameOf = (id: string) => r.standings.find((p) => p.id === id)?.name ?? "?";
    $("res-winner").textContent = r.draw
      ? `NO WINNER — ${r.winnerIds.map(nameOf).join(" & ")} TIED`
      : `★ ${nameOf(r.winnerId ?? "")} WINS ★`;
    $("res-sub").textContent =
      r.reason === "opponents_left"
        ? "ALL OPPONENTS LEFT"
        : r.reason === "last_standing"
          ? "LAST PLAYER STANDING"
          : r.draw
            ? "TIME UP · TIED FOR MOST KILLS"
            : "TIME UP · MOST KILLS WINS";
    const body = $("res-body");
    body.replaceChildren();
    let rank = 0;
    r.standings.forEach((p, i) => {
      if (i === 0 || p.score !== r.standings[i - 1]!.score) rank = i + 1; // equal kills share a rank
      const tr = el("tr", r.winnerIds.includes(p.id) ? "winner" : undefined);
      const rankCell = el("td", `rank r${Math.min(rank, 4)}`, String(rank));
      const nameCell = el("td");
      const sw = el("span", "sw");
      sw.style.background = SLOT_CSS[slots.get(p.id) ?? 0] ?? "#fff";
      nameCell.append(sw, document.createTextNode(p.name + (p.id === you ? " (you)" : "") + (p.disconnected ? " (left)" : "")));
      const kd = (p.score / Math.max(1, p.deaths)).toFixed(2);
      const acc = p.shots > 0 ? `${Math.round((p.hits / p.shots) * 100)}%` : "—";
      tr.append(
        rankCell,
        nameCell,
        el("td", "num", String(p.score)),
        el("td", "num", String(p.deaths)),
        el("td", "num", kd),
        el("td", "num", acc),
        el("td", "num", String(p.bestStreak)),
      );
      body.append(tr);
    });
    this.show("results");
  }
}
