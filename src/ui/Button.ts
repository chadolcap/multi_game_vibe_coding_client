// 재사용 가능한 간단한 Pixi 버튼. 배경 사각형 + 라벨 텍스트.
import { Container, Graphics, Text } from "pixi.js";

export interface ButtonOptions {
  label: string;
  width?: number;
  height?: number;
  onClick: () => void;
}

const COLOR_IDLE = 0x2f6feb;
const COLOR_HOVER = 0x4c86f5;
const COLOR_DISABLED = 0x555555;

export class Button extends Container {
  private readonly background: Graphics;
  private readonly text: Text;
  private readonly width_: number;
  private readonly height_: number;
  private enabled_ = true;

  constructor(options: ButtonOptions) {
    super();
    this.width_ = options.width ?? 220;
    this.height_ = options.height ?? 56;

    this.background = new Graphics();
    this.text = new Text({
      text: options.label,
      style: { fill: 0xffffff, fontSize: 20, fontFamily: "sans-serif" },
    });
    this.text.anchor.set(0.5);
    this.text.position.set(this.width_ / 2, this.height_ / 2);

    this.addChild(this.background, this.text);
    this.Draw(COLOR_IDLE);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerover", () => this.enabled_ && this.Draw(COLOR_HOVER));
    this.on("pointerout", () => this.enabled_ && this.Draw(COLOR_IDLE));
    this.on("pointertap", () => this.enabled_ && options.onClick());
  }

  public SetEnabled(enabled: boolean): void {
    this.enabled_ = enabled;
    this.eventMode = enabled ? "static" : "none";
    this.cursor = enabled ? "pointer" : "default";
    this.Draw(enabled ? COLOR_IDLE : COLOR_DISABLED);
  }

  private Draw(color: number): void {
    this.background.clear();
    this.background.roundRect(0, 0, this.width_, this.height_, 8).fill(color);
  }
}
