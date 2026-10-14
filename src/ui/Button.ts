// 재사용 가능한 간단한 Pixi 버튼. 배경 사각형 + 라벨 텍스트.
import { Container, Graphics, Text } from "pixi.js";
import { DEFAULT_UI_THEME, type UiTheme } from "./UiTheme";

export interface ButtonOptions {
  label: string;
  width?: number;
  height?: number;
  onClick: () => void;
  theme?: UiTheme;
}

// 버튼 그림자(button_shadow_color)를 아래로 얼마나 내려 그릴지.
const SHADOW_OFFSET = 6;

export class Button extends Container {
  private readonly background: Graphics;
  private readonly text: Text;
  private readonly width_: number;
  private readonly height_: number;
  private readonly theme: UiTheme;
  private enabled_ = true;

  constructor(options: ButtonOptions) {
    super();
    this.width_ = options.width ?? 220;
    this.height_ = options.height ?? 56;
    this.theme = options.theme ?? DEFAULT_UI_THEME;

    this.background = new Graphics();
    this.text = new Text({
      text: options.label,
      style: { fill: this.theme.button_text_color, fontSize: 20, fontFamily: this.theme.font_family },
    });
    this.text.anchor.set(0.5);
    this.text.position.set(this.width_ / 2, this.height_ / 2);

    this.addChild(this.background, this.text);
    this.Draw(this.theme.button_idle_color);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerover", () => this.enabled_ && this.Draw(this.theme.button_hover_color));
    this.on("pointerout", () => this.enabled_ && this.Draw(this.theme.button_idle_color));
    this.on("pointertap", () => this.enabled_ && options.onClick());
  }

  public SetLabel(label: string): void {
    this.text.text = label;
  }

  public SetEnabled(enabled: boolean): void {
    this.enabled_ = enabled;
    this.eventMode = enabled ? "static" : "none";
    this.cursor = enabled ? "pointer" : "default";
    this.Draw(enabled ? this.theme.button_idle_color : this.theme.button_disabled_color);
  }

  private Draw(color: number): void {
    this.background.clear();
    const radius = this.theme.button_radius;
    if (this.theme.button_shadow_color !== null) {
      this.background.roundRect(0, SHADOW_OFFSET, this.width_, this.height_, radius).fill(this.theme.button_shadow_color);
    }
    this.background.roundRect(0, 0, this.width_, this.height_, radius).fill(color);
  }
}
