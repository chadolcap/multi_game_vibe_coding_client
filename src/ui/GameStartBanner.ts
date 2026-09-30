// GAME_START 를 알리는 5초짜리 연출 배너. 타이머는 GameScene 이 관리하고, 이 컴포넌트는 보여주기/숨기기만 한다.
import { Container, Graphics, Text } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";

const BAR_HEIGHT = 140;

export class GameStartBanner extends Container {
  constructor() {
    super();
    this.visible = false;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.5 });

    const bar = new Graphics().rect(0, GAME_HEIGHT / 2 - BAR_HEIGHT / 2, GAME_WIDTH, BAR_HEIGHT).fill(0x2f6feb);

    const label = new Text({
      text: "GAME START",
      style: { fill: 0xffffff, fontSize: 56, fontFamily: "sans-serif", fontWeight: "bold" },
    });
    label.anchor.set(0.5);
    label.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2);

    this.addChild(dim, bar, label);
  }

  public Show(): void {
    this.visible = true;
  }

  public Hide(): void {
    this.visible = false;
  }
}
