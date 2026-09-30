// 최종 게임 결과 팝업 — 재시작 / 나가기 버튼 포함.
import { Container, Graphics, Text } from "pixi.js";
import { Button } from "./Button";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";

export interface GameResultPopupOptions {
  onReplay: () => void;
  onExit: () => void;
}

const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 480;
const PANEL_X = (GAME_WIDTH - PANEL_WIDTH) / 2;
const PANEL_Y = (GAME_HEIGHT - PANEL_HEIGHT) / 2;
const CONTENT_X = PANEL_X + 40;
const CONTENT_WIDTH = PANEL_WIDTH - 80;

export class GameResultPopup extends Container {
  private readonly content: Text;
  private readonly replay_button: Button;
  private readonly exit_button: Button;

  constructor(options: GameResultPopupOptions) {
    super();
    this.visible = false;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });
    dim.eventMode = "static"; // 뒤쪽 UI 클릭 차단(모달)

    const panel = new Graphics().roundRect(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, 16).fill(0x22243a);

    const title = new Text({
      text: "게임 결과",
      style: { fill: 0xffffff, fontSize: 28, fontFamily: "sans-serif", fontWeight: "bold" },
    });
    title.anchor.set(0.5, 0);
    title.position.set(GAME_WIDTH / 2, PANEL_Y + 32);

    this.content = new Text({
      text: "",
      style: {
        fill: 0xeaeaea,
        fontSize: 18,
        fontFamily: "monospace",
        wordWrap: true,
        wordWrapWidth: CONTENT_WIDTH,
        lineHeight: 28,
        align: "center",
      },
    });
    this.content.anchor.set(0.5, 0);
    this.content.position.set(GAME_WIDTH / 2, PANEL_Y + 110);

    this.replay_button = new Button({
      label: "재시작",
      width: CONTENT_WIDTH,
      height: 64,
      onClick: () => {
        this.DisableButtons();
        options.onReplay();
      },
    });
    this.replay_button.position.set(CONTENT_X, PANEL_Y + PANEL_HEIGHT - 64 * 2 - 24 - 16);

    this.exit_button = new Button({
      label: "나가기",
      width: CONTENT_WIDTH,
      height: 64,
      onClick: () => {
        this.DisableButtons();
        options.onExit();
      },
    });
    this.exit_button.position.set(CONTENT_X, PANEL_Y + PANEL_HEIGHT - 64 - 24);

    this.addChild(dim, panel, title, this.content, this.replay_button, this.exit_button);
  }

  public Show(content: string): void {
    this.content.text = content;
    this.replay_button.SetEnabled(true);
    this.exit_button.SetEnabled(true);
    this.visible = true;
  }

  public Hide(): void {
    this.visible = false;
  }

  public DisableButtons(): void {
    this.replay_button.SetEnabled(false);
    this.exit_button.SetEnabled(false);
  }
}
