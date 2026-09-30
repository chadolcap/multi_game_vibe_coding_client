// 별명 입력을 게임 내 팝업(어두운 배경 + 패널)으로 보여준다.
// Pixi 는 텍스트 입력을 직접 지원하지 않으므로, 실제 키 입력은 투명한 HTML <input> 으로 받아서
// Pixi 로 그린 입력창 자리 위에 정확히 겹쳐 놓는다 (캔버스 CSS 배율에 맞춰 위치/크기 동기화).
import { Container, Graphics, Text } from "pixi.js";
import { Button } from "./Button";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";

export interface NicknamePopupOptions {
  onSubmit: (name: string) => void;
}

const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 380;
const PANEL_X = (GAME_WIDTH - PANEL_WIDTH) / 2;
const PANEL_Y = (GAME_HEIGHT - PANEL_HEIGHT) / 2;

const INPUT_BOX = { x: PANEL_X + 40, y: PANEL_Y + 100, width: PANEL_WIDTH - 80, height: 68 };
const INPUT_FONT_SIZE = 22;

export class NicknamePopup extends Container {
  private readonly input_el: HTMLInputElement;
  private readonly error_text: Text;
  private readonly confirm_button: Button;
  private on_submit: ((name: string) => void) | null = null;
  private readonly reposition_input = () => this.RepositionInput();

  constructor() {
    super();
    this.visible = false;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });
    dim.eventMode = "static"; // 뒤쪽 UI 클릭 차단(모달)

    const panel = new Graphics().roundRect(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, 16).fill(0x22243a);

    const title = new Text({
      text: "별명 입력",
      style: { fill: 0xffffff, fontSize: 28, fontFamily: "sans-serif", fontWeight: "bold" },
    });
    title.anchor.set(0.5, 0);
    title.position.set(GAME_WIDTH / 2, PANEL_Y + 32);

    const input_box = new Graphics()
      .roundRect(INPUT_BOX.x, INPUT_BOX.y, INPUT_BOX.width, INPUT_BOX.height, 8)
      .fill(0x121320)
      .stroke({ width: 2, color: 0x444a6a });

    this.confirm_button = new Button({
      label: "확인",
      width: INPUT_BOX.width,
      height: 64,
      onClick: () => this.Submit(),
    });
    this.confirm_button.position.set(INPUT_BOX.x, INPUT_BOX.y + INPUT_BOX.height + 24);

    this.error_text = new Text({
      text: "",
      style: { fill: 0xff6b6b, fontSize: 15, fontFamily: "sans-serif" },
    });
    this.error_text.anchor.set(0.5, 0);
    this.error_text.position.set(GAME_WIDTH / 2, this.confirm_button.y + this.confirm_button.height + 16);

    this.addChild(dim, panel, title, input_box, this.confirm_button, this.error_text);

    this.input_el = document.createElement("input");
    this.input_el.type = "text";
    this.input_el.maxLength = 12;
    this.input_el.placeholder = "별명을 입력하세요";
    this.input_el.style.position = "absolute";
    this.input_el.style.display = "none";
    this.input_el.style.boxSizing = "border-box";
    this.input_el.style.padding = "0 16px";
    this.input_el.style.color = "#ffffff";
    this.input_el.style.background = "transparent";
    this.input_el.style.border = "none";
    this.input_el.style.outline = "none";
    this.input_el.style.zIndex = "10";
    this.input_el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.Submit();
    });

    const app_el = document.querySelector<HTMLDivElement>("#app");
    if (!app_el) throw new Error("#app 요소를 찾을 수 없습니다.");
    app_el.style.position = "relative";
    app_el.appendChild(this.input_el);

    window.addEventListener("resize", this.reposition_input);
  }

  public Show(options: NicknamePopupOptions): void {
    this.on_submit = options.onSubmit;
    this.error_text.text = "";
    this.input_el.value = "";
    this.visible = true;
    this.input_el.style.display = "block";
    this.RepositionInput();
    this.input_el.focus();
  }

  public Hide(): void {
    this.visible = false;
    this.input_el.style.display = "none";
    this.on_submit = null;
  }

  public SetError(message: string): void {
    this.error_text.text = message;
  }

  public DestroyPopup(): void {
    window.removeEventListener("resize", this.reposition_input);
    this.input_el.remove();
  }

  private Submit(): void {
    const name = this.input_el.value.trim();
    if (!name) return;
    this.on_submit?.(name);
  }

  private RepositionInput(): void {
    const canvas = document.querySelector<HTMLCanvasElement>("#app canvas");
    const app_el = document.querySelector<HTMLDivElement>("#app");
    if (!canvas || !app_el) return;

    const app_rect = app_el.getBoundingClientRect();
    const canvas_rect = canvas.getBoundingClientRect();
    const scale = canvas_rect.width / GAME_WIDTH;

    this.input_el.style.left = `${canvas_rect.left - app_rect.left + INPUT_BOX.x * scale}px`;
    this.input_el.style.top = `${canvas_rect.top - app_rect.top + INPUT_BOX.y * scale}px`;
    this.input_el.style.width = `${INPUT_BOX.width * scale}px`;
    this.input_el.style.height = `${INPUT_BOX.height * scale}px`;
    this.input_el.style.fontSize = `${INPUT_FONT_SIZE * scale}px`;
  }
}
