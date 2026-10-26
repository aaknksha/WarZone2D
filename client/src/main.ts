import Phaser from "phaser";
import "./styles/main.css";
import type { Snapshot } from "../../shared/protocol.ts";
import { BootScene } from "./game/scenes/BootScene.ts";
import { GameScene } from "./game/scenes/GameScene.ts";
import { MenuScene } from "./game/scenes/MenuScene.ts";
import { audio } from "./game/systems/audio.ts";
import { Net } from "./network/net.ts";
import { ERROR_TEXT, UI } from "./ui/ui.ts";

type Phase = "menu" | "lobby" | "playing" | "results";
let phase: Phase = "menu";
let slots = new Map<string, number>();
let names = new Map<string, string>();
let lastCount = -1;

const net = new Net();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0b0f0c",
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [BootScene, MenuScene, GameScene],
});

async function goMenu(leave: boolean): Promise<void> {
  if (leave) await net.leave();
  phase = "menu";
  ui.showHud(false);
  game.scene.stop("Game");
  if (!game.scene.isActive("Menu")) game.scene.start("Menu");
  ui.show("menu");
}

const ui = new UI({
  async onCreate(name) {
    ui.setBusy(true);
    const res = await net.create(name);
    ui.setBusy(false);
    if (!res.ok) return ui.setPlayError(ERROR_TEXT[res.error]);
    phase = "lobby";
    ui.renderLobby(res.lobby, res.you);
    ui.show("lobby");
  },
  async onJoin(name, code) {
    ui.setBusy(true);
    const res = await net.join(code, name);
    ui.setBusy(false);
    if (!res.ok) return ui.setPlayError(ERROR_TEXT[res.error]);
    phase = "lobby";
    ui.renderLobby(res.lobby, res.you);
    ui.show("lobby");
  },
  async onStart() {
    ui.setBusy(true);
    const res = await net.start();
    ui.setBusy(false);
    if (!res.ok) ui.setLobbyError(ERROR_TEXT[res.error]);
  },
  onLeaveLobby() {
    void goMenu(true);
  },
  onBackToMenu() {
    void goMenu(true);
  },
  onToggleMute() {
    audio.setMuted(!audio.muted);
    return audio.muted;
  },
});

ui.setMuted(audio.muted);
ui.show("menu");
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button")) audio.click(); // also unlocks audio on first gesture
});

net.on("status", (s) => {
  ui.setConn(s);
  if (s === "offline" && phase !== "menu") {
    ui.toast("Connection lost");
    // Keep the current scene alive while Socket.IO attempts recovery.
  }
});

net.on("lobby", (l) => {
  if (phase === "menu" || phase === "lobby") {
    phase = "lobby";
    ui.renderLobby(l, net.id);
    ui.show("lobby");
  }
});

net.on("matchStart", ({ snapshot }) => {
  phase = "playing";
  lastCount = -1;
  slots = new Map(snapshot.players.map((p, i) => [p.id, i]));
  names = new Map(snapshot.players.map((p) => [p.id, p.name]));
  ui.show("none");
  ui.initHud(snapshot, net.id);
  ui.showHud(true);
  game.scene.stop("Menu");
  game.scene.start("Game", { net, you: net.id, config: net.config, snapshot });
  ui.toast("WASD move · Mouse aim · Click or Space to fire", 7000);
});

net.on("state", (s: Snapshot) => {
  if (phase !== "playing") return;
  ui.updateHud(s, net.id);
  const n = Math.ceil(s.countdownMs / 1000);
  if (n > 0 && n !== lastCount) {
    lastCount = n;
    ui.banner(String(n), "count", 950);
    audio.beep();
  }
});

net.on("events", (events) => {
  if (phase !== "playing") return;
  for (const e of events) {
    if (e.type === "go") {
      lastCount = 0;
      ui.banner("FIGHT! ⚔️", "fight", 1300);
      audio.fight();
    } else if (e.type === "respawn" && e.player === net.id) {
      ui.banner("BACK IN THE FIGHT", "small", 1300);
      audio.respawn();
    } else if (e.type === "kill") {
      const victim = { name: names.get(e.victim) ?? "?", slot: slots.get(e.victim) ?? 0 };
      const killer = e.killer ? { name: names.get(e.killer) ?? "?", slot: slots.get(e.killer) ?? 0 } : null;
      if (e.victim === net.id) ui.setKilledBy(killer ? killer.name : null);
      ui.addKill(killer, victim, e.reason, e.streak);
    }
  }
});

net.on("matchEnd", ({ result }) => {
  // brief pause so players can see the final moments before the results screen
  window.setTimeout(() => {
    if (phase !== "playing") return;
    phase = "results";
    ui.showHud(false);
    ui.showResults(result, net.id, slots);
    if (result.draw) audio.draw();
    else if (result.winnerId === net.id) audio.victory();
    else audio.defeat();
  }, 1400);
});

net.on("roomClosed", () => {
  if (phase !== "menu") {
    ui.toast("The room was closed");
    void goMenu(false);
  }
});

net.on("shutdown", () => ui.toast("Server is restarting…", 6000));
