// 서버에서 받은 정보를 보여주는 범용 팝업 (어두운 배경 + 패널 + 내용 + 닫기 버튼).
import { Container, Graphics, Text } from "pixi.js";
import { Button } from "./Button";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";

const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 560;
const PANEL_X = (GAME_WIDTH - PANEL_WIDTH) / 2;
const PANEL_Y = (GAME_HEIGHT - PANEL_HEIGHT) / 2;
const CONTENT_X = PANEL_X + 40;
const CONTENT_Y = PANEL_Y + 100;
const CONTENT_WIDTH = PANEL_WIDTH - 80;

export class InfoPopup extends Container {
  private readonly title: Text;
  private readonly content: Text;
  private readonly close_button: Button;
  // 팝업이 닫힐 때 호출된다(HTML 오버레이처럼 캔버스 위에 떠 있는 요소를 복원하는 용도).
  public on_close?: () => void;

  constructor() {
    super();
    this.visible = false;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });
    dim.eventMode = "static"; // 뒤쪽 UI 클릭 차단(모달)

    const panel = new Graphics().roundRect(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, 16).fill(0x22243a);

    this.title = new Text({
      text: "정보",
      style: { fill: 0xffffff, fontSize: 28, fontFamily: "sans-serif", fontWeight: "bold" },
    });
    this.title.anchor.set(0.5, 0);
    this.title.position.set(GAME_WIDTH / 2, PANEL_Y + 32);

    this.content = new Text({
      text: "",
      style: {
        fill: 0xeaeaea,
        fontSize: 17,
        fontFamily: "monospace",
        wordWrap: true,
        wordWrapWidth: CONTENT_WIDTH,
        lineHeight: 26,
      },
    });
    this.content.position.set(CONTENT_X, CONTENT_Y);

    this.close_button = new Button({
      label: "닫기",
      width: CONTENT_WIDTH,
      height: 64,
      onClick: () => this.Hide(),
    });
    this.close_button.position.set(CONTENT_X, PANEL_Y + PANEL_HEIGHT - 64 - 32);

    this.addChild(dim, panel, this.title, this.content, this.close_button);
  }

  public Show(title: string, content: string): void {
    this.title.text = title;
    this.content.text = content;
    this.visible = true;
  }

  public Hide(): void {
    this.visible = false;
    this.on_close?.();
  }
}
