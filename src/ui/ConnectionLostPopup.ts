// 서버와 통신이 안 될 때(서버 꺼짐/연결 끊김) 알려주는 팝업 — 닫는 방법 없이 버튼 하나(로비 접속)로만 빠져나간다.
// 로비 씬과 게임 씬이 같이 쓴다. 서버/네트워크는 모르고, 버튼을 누르면 onConfirm 만 호출한다.
import { Container, Graphics, Text } from "pixi.js";
import { Button } from "./Button";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";
import { DrawThemedPanel, type UiTheme } from "./UiTheme";

export interface ConnectionLostPopupOptions {
  button_label: string;
  onConfirm: () => void;
  theme: UiTheme;
}

const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 380;
const PANEL_X = (GAME_WIDTH - PANEL_WIDTH) / 2;
const PANEL_Y = (GAME_HEIGHT - PANEL_HEIGHT) / 2;
const CONTENT_X = PANEL_X + 40;
const CONTENT_WIDTH = PANEL_WIDTH - 80;

export class ConnectionLostPopup extends Container {
  private readonly message_text: Text;

  constructor(options: ConnectionLostPopupOptions) {
    super();
    this.visible = false;
    const theme = options.theme;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.7 });
    dim.eventMode = "static"; // 뒤쪽 UI 클릭 차단(모달)

    const panel = DrawThemedPanel(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, theme);

    const title = new Text({
      text: "서버와 연결할 수 없습니다",
      style: { fill: theme.error_color, fontSize: 28, fontFamily: theme.font_family, fontWeight: "bold" },
    });
    title.anchor.set(0.5, 0);
    title.position.set(GAME_WIDTH / 2, PANEL_Y + 36);

    this.message_text = new Text({
      text: "",
      style: {
        fill: theme.text_color,
        fontSize: 20,
        fontFamily: theme.font_family,
        wordWrap: true,
        wordWrapWidth: CONTENT_WIDTH,
        lineHeight: 30,
        align: "center",
      },
    });
    this.message_text.anchor.set(0.5, 0);
    this.message_text.position.set(GAME_WIDTH / 2, PANEL_Y + 110);

    const button = new Button({
      label: options.button_label,
      width: CONTENT_WIDTH,
      height: 64,
      theme,
      onClick: () => options.onConfirm(),
    });
    button.position.set(CONTENT_X, PANEL_Y + PANEL_HEIGHT - 64 - 32);

    this.addChild(dim, panel, title, this.message_text, button);
  }

  public Show(message: string): void {
    this.message_text.text = message;
    this.visible = true;
  }

  public Hide(): void {
    this.visible = false;
  }
}
