// 로비에서 참여할 게임을 고르는 드롭다운. Pixi 는 네이티브 select 를 지원하지 않으므로, 실제 선택은
// 투명한 HTML <select> 로 받아서 Pixi 로 그린 박스 자리 위에 겹쳐 놓는다
// (NicknamePopup 의 <input> 오버레이와 같은 패턴 — 캔버스 CSS 배율에 맞춰 위치/크기 동기화).
import { Container, Graphics } from "pixi.js";
import { GameId } from "../common/types";
import { GAME_WIDTH } from "../config";
import { ToCssColor, type UiTheme } from "./UiTheme";

interface GameOption {
  value: GameId;
  label: string;
  enabled: boolean;
}

// 아직 게임 로직이 없는 게임을 추가할 때는 enabled:false 로 보여주기만 하고, 완성되면 켠다.
const OPTIONS: GameOption[] = [
  { value: GameId.RPS, label: "가위바위보", enabled: true },
  { value: GameId.OTHELLO, label: "오델로", enabled: true },
  { value: GameId.STEPPING, label: "점핑", enabled: true },
  { value: GameId.AIRHOCKEY, label: "에어하키", enabled: true },
];

// 게임 표시 이름(가위바위보/오델로/점핑) — 목록에 없으면 식별자를 그대로 쓴다.
export function GetGameLabel(game: GameId): string {
  return OPTIONS.find((option) => option.value === game)?.label ?? game;
}

export const SELECT_WIDTH = 440;
const SELECT_HEIGHT = 64;
const FONT_SIZE = 18;

export class GameSelect extends Container {
  private readonly select_el: HTMLSelectElement;
  private readonly reposition = () => this.Reposition();

  constructor(theme: UiTheme) {
    super();
    this.visible = false;

    const box = new Graphics()
      .roundRect(0, 0, SELECT_WIDTH, SELECT_HEIGHT, theme.panel_radius / 2)
      .fill(theme.input_color)
      .stroke({ width: 3, color: theme.input_border_color });
    this.addChild(box);

    this.select_el = document.createElement("select");
    this.select_el.style.position = "absolute";
    this.select_el.style.display = "none";
    this.select_el.style.boxSizing = "border-box";
    this.select_el.style.padding = "0 12px";
    this.select_el.style.color = ToCssColor(theme.input_text_color);
    this.select_el.style.fontFamily = theme.font_family;
    this.select_el.style.cursor = "pointer";
    // OS/브라우저가 다크 모드여도 펼친 목록(네이티브)을 밝은 바탕으로 그리게 고정한다 — 갈색 글자가 어두운 바탕에 묻히지 않게.
    this.select_el.style.colorScheme = "light";
    this.select_el.style.background = "transparent";
    this.select_el.style.border = "none";
    this.select_el.style.outline = "none";
    this.select_el.style.zIndex = "10";
    for (const option of OPTIONS) {
      const option_el = document.createElement("option");
      option_el.value = option.value;
      option_el.textContent = option.label;
      option_el.disabled = !option.enabled;
      // 펼친 목록은 브라우저가 흰 바탕으로 그리는데, 글자색은 <select> 의 흰색을 물려받아 안 보이므로 따로 지정한다.
      option_el.style.color = option.enabled ? "#1a1a2e" : "#9a9aa8";
      option_el.style.backgroundColor = "#ffffff";
      this.select_el.appendChild(option_el);
    }

    const app_el = document.querySelector<HTMLDivElement>("#app");
    if (!app_el) throw new Error("#app 요소를 찾을 수 없습니다.");
    app_el.appendChild(this.select_el);

    window.addEventListener("resize", this.reposition);
  }

  public Show(): void {
    this.visible = true;
    this.select_el.style.display = "block";
    this.Reposition();
  }

  public Hide(): void {
    this.visible = false;
    this.select_el.style.display = "none";
  }

  public GetSelectedGame(): GameId {
    return this.select_el.value as GameId;
  }

  public DestroySelect(): void {
    window.removeEventListener("resize", this.reposition);
    this.select_el.remove();
  }

  private Reposition(): void {
    const canvas = document.querySelector<HTMLCanvasElement>("#app canvas");
    const app_el = document.querySelector<HTMLDivElement>("#app");
    if (!canvas || !app_el) return;

    const app_rect = app_el.getBoundingClientRect();
    const canvas_rect = canvas.getBoundingClientRect();
    const scale = canvas_rect.width / GAME_WIDTH;

    this.select_el.style.left = `${canvas_rect.left - app_rect.left + this.x * scale}px`;
    this.select_el.style.top = `${canvas_rect.top - app_rect.top + this.y * scale}px`;
    this.select_el.style.width = `${SELECT_WIDTH * scale}px`;
    this.select_el.style.height = `${SELECT_HEIGHT * scale}px`;
    this.select_el.style.fontSize = `${FONT_SIZE * scale}px`;
  }
}
