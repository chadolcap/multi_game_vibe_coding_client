// 청기백기 조작 버튼 — 오리 양옆에 위/정지/아래 버튼을 세 개씩 둔다.
// 화면 왼쪽 = 청기(오리 오른손), 화면 오른쪽 = 백기(오리 왼손). 오리가 화면을 보고 서 있어서 오리 기준 손과 좌우가 바뀐다.
// 서버/네트워크는 모르고, 누르면 onPress 로 어느 깃발을 올리고/정지하고/내렸는지만 알린다.
// 좌표 기준점(0,0)은 패널 왼쪽 위이고, 패널 폭은 화면 폭(GAME_WIDTH) 전체다.
import { Container, Graphics, Text, Ticker } from "pixi.js";
import { GAME_WIDTH } from "../../config";
import { CUTE_COLOR, CUTE_FONT_FAMILY } from "../../ui/CuteTheme";
import { FLAG_DOWN, FLAG_KEEP, FLAG_UP, type FlagMove, type FlagSide } from "./types";

// 버튼 한 변 길이 / 버튼 가운데의 화면 가장자리로부터 거리.
const BUTTON_SIZE = 104;
const COLUMN_MARGIN_X = 74;
// 위/아래 버튼 가운데 사이 간격 — 오리 키(FLAG_DUCK_HEIGHT)에 맞춰 위 버튼은 머리, 아래 버튼은 발 높이쯤에 온다.
// 정지 버튼은 그 한가운데에 둔다(세 버튼이 겹치지 않게 버튼 크기를 줄였다).
export const FLAG_BUTTON_GAP_Y = 260;
// 버튼 위 깃발 이름표 높이.
const HEADER_HEIGHT = 44;
// 패널 안에서 아래 버튼 가운데의 y — 씬이 이 값으로 패널 높이를 맞춘다.
export const FLAG_DOWN_BUTTON_CENTER_Y = HEADER_HEIGHT + BUTTON_SIZE / 2 + FLAG_BUTTON_GAP_Y;
// 눌렀을 때 작아졌다 돌아오는 시간.
const PRESS_MS = 160;
const DISABLED_ALPHA = 0.4;

// 청기 색(시트 그림의 파란 깃발과 비슷하게) / 백기 테두리 색.
const BLUE_FLAG_COLOR = 0x1f5fe0;
const WHITE_FLAG_EDGE = 0x9aa4b2;

export interface FlagControlPanelOptions {
  onPress: (side: FlagSide, move: FlagMove) => void;
}

interface ArrowButton {
  view: Container;
  press_elapsed_ms: number;
}

export class FlagControlPanel extends Container {
  private readonly buttons: ArrowButton[] = [];
  private enabled = false;

  constructor(options: FlagControlPanelOptions) {
    super();

    const columns: { side: FlagSide; label: string; x: number }[] = [
      { side: "b", label: "청기", x: COLUMN_MARGIN_X },
      { side: "w", label: "백기", x: GAME_WIDTH - COLUMN_MARGIN_X },
    ];
    for (const column of columns) {
      this.addChild(CreateColumnLabel(column.label, column.side, column.x));
      for (const move of [FLAG_UP, FLAG_KEEP, FLAG_DOWN] as const) {
        // 위 = 0, 정지 = 가운데, 아래 = GAP.
        const y = HEADER_HEIGHT + BUTTON_SIZE / 2 + ((FLAG_UP - move) * FLAG_BUTTON_GAP_Y) / 2;
        const button: ArrowButton = { view: CreateArrowButton(column.side, move), press_elapsed_ms: Number.POSITIVE_INFINITY };
        button.view.position.set(column.x, y);
        button.view.eventMode = "static";
        button.view.cursor = "pointer";
        // 제한 시간 안에 답해야 해서 손을 뗄 때(tap)가 아니라 누르는 순간 반응한다.
        button.view.on("pointerdown", () => {
          if (!this.enabled) return;
          button.press_elapsed_ms = 0;
          options.onPress(column.side, move);
        });
        this.buttons.push(button);
        this.addChild(button.view);
      }
    }

    this.SetEnabled(false);
    Ticker.shared.add(this.OnTick);
  }

  // 문제가 나와 있는 동안만 누를 수 있다. 꺼지면 반투명하게 보인다.
  public SetEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const button of this.buttons) {
      button.view.alpha = enabled ? 1 : DISABLED_ALPHA;
      button.view.cursor = enabled ? "pointer" : "default";
    }
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  private readonly OnTick = (ticker: Ticker): void => {
    for (const button of this.buttons) {
      if (button.press_elapsed_ms >= PRESS_MS) {
        button.view.scale.set(1);
        continue;
      }
      button.press_elapsed_ms += ticker.deltaMS;
      const t = Math.min(1, button.press_elapsed_ms / PRESS_MS);
      button.view.scale.set(1 - Math.sin(Math.PI * t) * 0.12);
    }
  };
}

// 버튼 위 깃발 이름표("청기"/"백기") — 깃발 색으로 칠한 작은 알약 모양.
function CreateColumnLabel(label: string, side: FlagSide, x: number): Container {
  const tag = new Container();
  const is_blue = side === "b";
  const background = new Graphics()
    .roundRect(-48, 0, 96, 36, 18)
    .fill(is_blue ? BLUE_FLAG_COLOR : 0xffffff)
    .stroke({ color: is_blue ? BLUE_FLAG_COLOR : WHITE_FLAG_EDGE, width: 3 });
  const text = new Text({
    text: label,
    style: { fill: is_blue ? 0xffffff : CUTE_COLOR.brown, fontSize: 22, fontFamily: CUTE_FONT_FAMILY },
  });
  text.anchor.set(0.5);
  text.position.set(0, 18);
  tag.addChild(background, text);
  tag.position.set(x, 0);
  return tag;
}

// 둥근 사각형 + 위/아래 화살표(정지는 가로 막대). 기준점(0,0)은 버튼 가운데(누를 때 가운데를 기준으로 작아진다).
function CreateArrowButton(side: FlagSide, move: FlagMove): Container {
  const button = new Container();
  const half = BUTTON_SIZE / 2;
  const is_blue = side === "b";
  const face_color = is_blue ? BLUE_FLAG_COLOR : 0xffffff;
  const edge_color = is_blue ? 0x123f9e : WHITE_FLAG_EDGE;
  const arrow_color = is_blue ? 0xffffff : BLUE_FLAG_COLOR;

  const background = new Graphics()
    .roundRect(-half, -half + 6, BUTTON_SIZE, BUTTON_SIZE, 26)
    .fill({ color: 0x000000, alpha: 0.12 })
    .roundRect(-half, -half, BUTTON_SIZE, BUTTON_SIZE, 26)
    .fill(face_color)
    .stroke({ color: edge_color, width: 4 });

  // 정지 = 깃발을 수평으로 든 모양의 가로 막대.
  if (move === FLAG_KEEP) {
    const bar = new Graphics().roundRect(-32, -9, 64, 18, 9).fill(arrow_color);
    button.addChild(background, bar);
    return button;
  }

  // 위쪽 화살표를 그리고, 아래 버튼은 뒤집는다.
  const direction = move === FLAG_UP ? 1 : -1;
  const arrow = new Graphics()
    .poly([0, -34 * direction, 30, -2 * direction, 12, -2 * direction, 12, 32 * direction, -12, 32 * direction, -12, -2 * direction, -30, -2 * direction])
    .fill(arrow_color);

  button.addChild(background, arrow);
  return button;
}
