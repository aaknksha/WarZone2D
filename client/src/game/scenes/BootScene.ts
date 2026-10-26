import Phaser from "phaser";
import { generateTextures } from "../textures.ts";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }
  create(): void {
    generateTextures(this);
    this.scene.start("Menu");
  }
}
