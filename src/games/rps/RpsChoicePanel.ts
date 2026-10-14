// 가위/바위/보 선택 버튼 3개를 가로로 배치한 패널.
// 각 버튼은 동그란 판 위에 귀여운 손 모양 이미지 + 아래 이름표로 그린다.
// 상태: 한 판 시작 전(회색, 눌린 채 납작) → 한 판 진행 중(입체 버튼, 눌러짐) → 선택 후(고른 버튼만 강조, 나머지 흐리게).
import { ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, Text, Texture, Ticker } from "pixi.js";
import { RpsChoice } from "./types";
import { CUTE_COLOR, CUTE_FONT_FAMILY, LoadCuteTexture } from "../../ui/CuteTheme";
import hand_scissors_url from "./assets/hand_scissors.svg";
import hand_rock_url from "./assets/hand_rock.svg";
import hand_paper_url from "./assets/hand_paper.svg";

export interface RpsChoicePanelOptions {
  onSelect: (choice: RpsChoice) => void;
}

const BUTTON_WIDTH = 200;
const BUTTON_HEIGHT = 240;
const GAP = 20;
export const RPS_PANEL_WIDTH = BUTTON_WIDTH * 3 + GAP * 2;
export const RPS_PANEL_HEIGHT = BUTTON_HEIGHT;

const CIRCLE_RADIUS = 86;
const CIRCLE_Y = 92;
const HAND_SIZE = 140;
// 입체 버튼 옆면 두께 — 판(face)이 이만큼 내려가면 완전히 눌린 모양이 된다.
const DEPTH = 12;
const HOVER_LIFT = 3;
// 한 판 진행 중 버튼이 "눌러 달라"는 듯 살짝 커졌다 작아지는 정도/주기.
const PULSE_SCALE = 0.03;
const PULSE_PERIOD_MS = 900;
const HOVER_SCALE = 1.05;
// 고르지 않은 버튼을 흐리게 보여줄 때의 투명도.
const DIMMED_ALPHA = 0.45;

type ButtonState = "waiting" | "active" | "chosen" | "dimmed";

// 선택지별 이미지와 테두리 색.
const CHOICE_VISUALS: Record<RpsChoice, { url: string; color: number }> = {
  [RpsChoice.SCISSORS]: { url: hand_scissors_url, color: CUTE_COLOR.pink },
  [RpsChoice.ROCK]: { url: hand_rock_url, color: CUTE_COLOR.yellow },
  [RpsChoice.PAPER]: { url: hand_paper_url, color: CUTE_COLOR.mint },
};

class RpsChoiceButton extends Container {
  private readonly side: Graphics;
  private readonly face = new Container();
  private readonly plate: Graphics;
  private readonly ring_color: number;
  private readonly gray_filter = new ColorMatrixFilter();
  private state: ButtonState = "waiting";
  private hovered = false;
  private pressed = false;

  constructor(choice: RpsChoice, onClick: () => void) {
    super();
    const visual = CHOICE_VISUALS[choice];
    this.ring_color = visual.color;
    this.gray_filter.desaturate();

    // 입체 버튼의 옆면(아래쪽 두께).
    this.side = new Graphics();
    this.plate = new Graphics();

    // 위쪽 반사광 — 버튼처럼 보이게 하는 광택.
    const gloss = new Graphics()
      .ellipse(BUTTON_WIDTH / 2 - 18, CIRCLE_Y - 48, 42, 20)
      .fill({ color: 0xffffff, alpha: 0.7 });

    const hand = new Sprite(Texture.EMPTY);
    hand.anchor.set(0.5);
    hand.position.set(BUTTON_WIDTH / 2, CIRCLE_Y);
    LoadCuteTexture(visual.url).then((texture) => {
      // 불러오는 사이에 씬이 파괴됐을 수 있다.
      if (hand.destroyed) return;
      hand.texture = texture;
      hand.width = HAND_SIZE;
      hand.height = HAND_SIZE;
    });
    this.face.addChild(this.plate, gloss, hand);

    const name_tag = new Graphics().roundRect(BUTTON_WIDTH / 2 - 56, 196, 112, 40, 20).fill(visual.color);
    const name_text = new Text({
      text: choice,
      style: {
        fill: 0xffffff,
        fontSize: 24,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: CUTE_COLOR.brown, width: 4, join: "round" },
      },
    });
    name_text.anchor.set(0.5);
    name_text.position.set(BUTTON_WIDTH / 2, 216);

    this.addChild(this.side, this.face, name_tag, name_text);

    // 확대/축소가 버튼 가운데를 기준으로 일어나도록 pivot 을 가운데에 둔다.
    this.pivot.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
    this.hitArea = new Rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT);
    this.on("pointerover", () => this.SetPointer(true, this.pressed));
    this.on("pointerout", () => this.SetPointer(false, false));
    this.on("pointerdown", () => this.SetPointer(this.hovered, true));
    this.on("pointerupoutside", () => this.SetPointer(false, false));
    this.on("pointerup", () => this.SetPointer(this.hovered, false));
    this.on("pointertap", () => this.state === "active" && onClick());

    this.Refresh();
  }

  public SetState(state: ButtonState): void {
    this.state = state;
    this.pressed = false;
    this.Refresh();
  }

  // 한 판 진행 중일 때만 Panel 이 매 프레임 불러 숨쉬듯 커졌다 작아지게 한다.
  public Pulse(elapsed_ms: number, phase_offset: number): void {
    if (this.state !== "active") return;
    const base = this.hovered ? HOVER_SCALE : 1;
    const pulse = this.hovered ? 0 : Math.sin((elapsed_ms / PULSE_PERIOD_MS) * Math.PI * 2 + phase_offset) * PULSE_SCALE;
    this.scale.set(base + pulse);
  }

  private SetPointer(hovered: boolean, pressed: boolean): void {
    this.hovered = hovered;
    this.pressed = pressed;
    this.Refresh();
  }

  private Refresh(): void {
    const active = this.state === "active";
    this.eventMode = active ? "static" : "none";
    this.cursor = active ? "pointer" : "default";

    // 한 판 시작 전에는 회색으로, 고르지 않은 버튼은 흐리게.
    this.filters = this.state === "waiting" ? [this.gray_filter] : [];
    this.alpha = this.state === "dimmed" ? DIMMED_ALPHA : this.state === "waiting" ? 0.85 : 1;
    if (!active) this.scale.set(this.state === "chosen" ? HOVER_SCALE : 1);

    // 판 높이: 진행 중엔 떠 있고(마우스를 올리면 더 뜸, 누르면 쑥 들어감), 그 외엔 눌린 채로.
    if (active) {
      this.face.y = this.pressed ? DEPTH - 2 : this.hovered ? -HOVER_LIFT : 0;
    } else {
      this.face.y = this.state === "chosen" ? DEPTH * 0.6 : DEPTH;
    }

    const chosen = this.state === "chosen";
    const ring_color = chosen ? CUTE_COLOR.orange : this.ring_color;
    this.side
      .clear()
      // 바닥 그림자
      .ellipse(BUTTON_WIDTH / 2, CIRCLE_Y + DEPTH + CIRCLE_RADIUS - 4, CIRCLE_RADIUS * 0.8, 10)
      .fill({ color: 0x000000, alpha: 0.12 })
      .circle(BUTTON_WIDTH / 2, CIRCLE_Y + DEPTH, CIRCLE_RADIUS + 4)
      .fill(Darken(ring_color, 0.75));
    this.plate
      .clear()
      .circle(BUTTON_WIDTH / 2, CIRCLE_Y, CIRCLE_RADIUS)
      .fill(chosen ? 0xfff3c4 : 0xffffff)
      .stroke({ color: ring_color, width: chosen ? 12 : 8 });
  }
}

export class RpsChoicePanel extends Container {
  private readonly buttons: Map<RpsChoice, RpsChoiceButton>;
  // 이번 판에 고른 값 — 선택 후 비활성화돼도 고른 버튼은 강조해서 보여준다.
  private selected: RpsChoice | null = null;
  private elapsed_ms = 0;

  constructor(options: RpsChoicePanelOptions) {
    super();

    const choices: RpsChoice[] = [RpsChoice.SCISSORS, RpsChoice.ROCK, RpsChoice.PAPER];
    this.buttons = new Map(
      choices.map((choice, index) => {
        const button = new RpsChoiceButton(choice, () => {
          this.selected = choice;
          this.SetEnabled(false);
          options.onSelect(choice);
        });
        // pivot 이 가운데이므로 위치도 버튼 가운데 좌표로 잡는다.
        button.position.set(index * (BUTTON_WIDTH + GAP) + BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
        return [choice, button] as const;
      })
    );

    for (const button of this.buttons.values()) this.addChild(button);
    Ticker.shared.add(this.OnTick);
  }

  // true: 한 판 시작 — 이전 판 선택을 지우고 누를 수 있게 한다.
  // false: 선택을 마감 — 이번 판에 고른 게 있으면 그 버튼만 강조, 없으면 한 판 시작 전처럼 회색.
  public SetEnabled(enabled: boolean): void {
    if (enabled) {
      this.selected = null;
      for (const button of this.buttons.values()) button.SetState("active");
      return;
    }
    if (this.selected === null) {
      this.SetWaiting();
      return;
    }
    for (const [choice, button] of this.buttons) button.SetState(choice === this.selected ? "chosen" : "dimmed");
  }

  // 아직 한 판이 시작되지 않은 상태 — 전부 회색으로 눌린 채 둔다.
  public SetWaiting(): void {
    this.selected = null;
    for (const button of this.buttons.values()) button.SetState("waiting");
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  private readonly OnTick = (ticker: Ticker): void => {
    if (!this.visible) return;
    this.elapsed_ms += ticker.deltaMS;
    let index = 0;
    for (const button of this.buttons.values()) button.Pulse(this.elapsed_ms, index++ * 0.9);
  };
}

// 색을 factor 비율만큼 어둡게 한다(입체 버튼 옆면 색).
function Darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
