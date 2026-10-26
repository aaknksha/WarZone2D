import Phaser from "phaser";
import { ARENA, WALLS } from "../../../shared/map.ts";

/** Draws the battlefield. Shared by the menu backdrop and the live match so both show the same world. */
export function buildArena(scene: Phaser.Scene): void {
  scene.add.tileSprite(0, 0, ARENA.width, ARENA.height, "ground").setOrigin(0).setDepth(0);
  // dirt tracks crossing the arena
  scene.add.tileSprite(0, 560, ARENA.width, 80, "dirt").setOrigin(0).setDepth(1).setAlpha(0.9);
  scene.add.tileSprite(740, 0, 120, ARENA.height, "dirt").setOrigin(0).setDepth(1).setAlpha(0.9);
  // hazard-striped boundary (purely visual; the server clamps players inside it)
  const t = 12;
  scene.add.tileSprite(0, 0, ARENA.width, t, "hazard").setOrigin(0).setDepth(6);
  scene.add.tileSprite(0, ARENA.height - t, ARENA.width, t, "hazard").setOrigin(0).setDepth(6);
  scene.add.tileSprite(0, 0, t, ARENA.height, "hazard").setOrigin(0).setDepth(6);
  scene.add.tileSprite(ARENA.width - t, 0, t, ARENA.height, "hazard").setOrigin(0).setDepth(6);
  WALLS.forEach((w, i) => {
    scene.add.rectangle(w.x + 5, w.y + 6, w.w, w.h, 0x000000, 0.35).setOrigin(0).setDepth(4);
    scene.add.image(w.x, w.y, `wall${i}`).setOrigin(0).setDepth(5);
  });
}
