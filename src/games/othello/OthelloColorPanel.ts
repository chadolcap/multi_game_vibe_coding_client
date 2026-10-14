// 돌 색 선택(흰색/검정) 팝업 — 화면 전체를 딤드 처리하고 말판 가운데에 선택 창을 띄운다(모달).
// 버튼 왼쪽에 해당 색 돌 그림을 붙이고, 남은 선택 시간도 창 안에 함께 표기한다.
import { Container, Graphics, Text } from "pixi.js";
import { Button } from "../../ui/Button";
import { CUTE_COLOR, CUTE_FONT_FAMILY, CUTE_THEME } from "../../ui/CuteTheme";
import { GAME_WIDTH, GAME_HEIGHT } from "../../config";
import { OthelloColor } from "./types";

export interface OthelloColorPanelOptions {
  onSelect: (color: OthelloColor) => void;
  // 선택 창의 세로 가운데 위치 — 말판 가운데에 맞춘다.
  center_y: number;
}

const BUTTON_WIDTH = 270;
const BUTTON_HEIGHT = 88;
const GAP = 20;
const WINDOW_WIDTH = BUTTON_WIDTH * 2 + GAP + 60;
const WINDOW_HEIGHT = 320;
const DIM_ALPHA = 0.5;

const ICON_RADIUS = 22;

export class OthelloColorPanel extends Container {
  private readonly buttons: Button[];
  private readonly message_text: Text;
  private readonly countdown_text: Text;

  constructor(options: OthelloColorPanelOptions) {
    super();

    const window_x = (GAME_WIDTH - WINDOW_WIDTH) / 2;
    const window_y = options.center_y - WINDOW_HEIGHT / 2;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: DIM_ALPHA });
    dim.eventMode = "static"; // 뒤쪽 UI 클릭 차단(모달)

    const window_box = new Graphics()
      .roundRect(window_x, window_y + 8, WINDOW_WIDTH, WINDOW_HEIGHT, 32)
      .fill({ color: 0x000000, alpha: 0.15 })
      .roundRect(window_x, window_y, WINDOW_WIDTH, WINDOW_HEIGHT, 32)
      .fill(CUTE_COLOR.cream)
      .stroke({ color: CUTE_COLOR.shirt, width: 6 });

    const title = new Text({
      text: "돌 색을 선택하세요",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 36,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 7, join: "round" },
      },
    });
    title.anchor.set(0.5, 0);
    title.position.set(GAME_WIDTH / 2, window_y + 30);

    this.message_text = new Text({
      text: "",
      style: { fill: CUTE_COLOR.brown, fontSize: 18, fontFamily: CUTE_FONT_FAMILY, align: "center" },
    });
    this.message_text.anchor.set(0.5, 0);
    this.message_text.position.set(GAME_WIDTH / 2, window_y + 84);

    const buttons_x = (GAME_WIDTH - (BUTTON_WIDTH * 2 + GAP)) / 2;
    const buttons_y = window_y + 128;
    const choices: { color: OthelloColor; label: string }[] = [
      { color: OthelloColor.WHITE, label: "흰색 돌" },
      { color: OthelloColor.BLACK, label: "검정 돌 (선공)" },
    ];
    this.buttons = choices.map((choice, index) => {
      const button = new Button({
        label: choice.label,
        width: BUTTON_WIDTH,
        height: BUTTON_HEIGHT,
        theme: CUTE_THEME,
        onClick: () => {
          this.SetEnabled(false);
          this.message_text.text = `${choice.color === OthelloColor.WHITE ? "흰색" : "검정"} 돌을 골랐어요! 결과를 기다리는 중...`;
          options.onSelect(choice.color);
        },
      });
      button.position.set(buttons_x + index * (BUTTON_WIDTH + GAP), buttons_y);
      button.addChild(CreateStoneIcon(choice.color));
      return button;
    });

    // 남은 선택 시간 — 창 아래쪽 가운데.
    this.countdown_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.red,
        fontSize: 30,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 6, join: "round" },
      },
    });
    this.countdown_text.anchor.set(0.5, 0);
    this.countdown_text.position.set(GAME_WIDTH / 2, buttons_y + BUTTON_HEIGHT + 24);

    this.addChild(dim, window_box, title, this.message_text, ...this.buttons, this.countdown_text);
    this.Reset();
  }

  public SetEnabled(enabled: boolean): void {
    for (const button of this.buttons) button.SetEnabled(enabled);
  }

  // DOLL_SELECT_REMAIN_TIME 의 남은 초.
  public SetCountdown(count: number): void {
    this.countdown_text.text = `${count}초`;
  }

  // 새 판 — 안내 문구/남은 시간을 처음 상태로 되돌린다.
  public Reset(): void {
    this.message_text.text = "시간 안에 아무도 고르지 않으면 랜덤으로 정해집니다";
    this.countdown_text.text = "";
  }
}

// 버튼 왼쪽에 붙이는 돌 그림(보드의 돌과 같은 모양: 두께 + 윗면 + 반사광).
function CreateStoneIcon(color: OthelloColor): Graphics {
  const is_white = color === OthelloColor.WHITE;
  const top = is_white ? 0xfdfdfd : 0x2b2b33;
  const side = is_white ? 0xd2d2d2 : 0x15151a;
  const icon = new Graphics()
    .circle(0, 3, ICON_RADIUS)
    .fill(side)
    .circle(0, 0, ICON_RADIUS)
    .fill(top)
    .stroke({ color: side, width: 2 })
    .ellipse(-ICON_RADIUS * 0.32, -ICON_RADIUS * 0.4, ICON_RADIUS * 0.42, ICON_RADIUS * 0.24)
    .fill({ color: 0xffffff, alpha: is_white ? 0.9 : 0.35 });
  icon.position.set(ICON_RADIUS + 18, BUTTON_HEIGHT / 2);
  return icon;
}
