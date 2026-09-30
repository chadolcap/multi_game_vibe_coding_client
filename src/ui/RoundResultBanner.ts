// ONE_RESULT 를 알리는 팝업 — 승/패/무승부를 잠깐 보여주고 자동으로 사라진다(타이머는 GameScene 이 관리).
import { Container, Graphics, Text } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";

const PANEL_WIDTH = 560;
const PANEL_HEIGHT = 260;
const PANEL_X = (GAME_WIDTH - PANEL_WIDTH) / 2;
const PANEL_Y = (GAME_HEIGHT - PANEL_HEIGHT) / 2;

export class RoundResultBanner extends Container {
  private readonly detail_text: Text;
  private readonly winner_text: Text;

  constructor() {
    super();
    this.visible = false;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });

    const panel = new Graphics().roundRect(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, 16).fill(0x22243a);

    this.detail_text = new Text({
      text: "",
      style: { fill: 0xeaeaea, fontSize: 20, fontFamily: "sans-serif", align: "center" },
    });
    this.detail_text.anchor.set(0.5, 0);
    this.detail_text.position.set(GAME_WIDTH / 2, PANEL_Y + 50);

    this.winner_text = new Text({
      text: "",
      style: { fill: 0xffd257, fontSize: 42, fontFamily: "sans-serif", fontWeight: "bold" },
    });
    this.winner_text.anchor.set(0.5, 0);
    this.winner_text.position.set(GAME_WIDTH / 2, PANEL_Y + 150);

    this.addChild(dim, panel, this.detail_text, this.winner_text);
  }

  public Show(detail: string, winner_label: string): void {
    this.detail_text.text = detail;
    this.winner_text.text = winner_label;
    this.visible = true;
  }

  public Hide(): void {
    this.visible = false;
  }
}
