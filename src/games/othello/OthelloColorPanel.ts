// 돌 색 선택(흰색/검정) 버튼 2개를 가로로 배치한 패널.
import { Container } from "pixi.js";
import { Button } from "../../ui/Button";
import { OthelloColor } from "./types";

export interface OthelloColorPanelOptions {
  onSelect: (color: OthelloColor) => void;
}

const BUTTON_WIDTH = 300;
const BUTTON_HEIGHT = 88;
const GAP = 20;
export const OTHELLO_COLOR_PANEL_WIDTH = BUTTON_WIDTH * 2 + GAP;

export class OthelloColorPanel extends Container {
  private readonly buttons: Button[];

  constructor(options: OthelloColorPanelOptions) {
    super();

    const choices: { color: OthelloColor; label: string }[] = [
      { color: OthelloColor.WHITE, label: "흰색 돌" },
      { color: OthelloColor.BLACK, label: "검정 돌 (선공)" },
    ];
    this.buttons = choices.map((choice, index) => {
      const button = new Button({
        label: choice.label,
        width: BUTTON_WIDTH,
        height: BUTTON_HEIGHT,
        onClick: () => {
          this.SetEnabled(false);
          options.onSelect(choice.color);
        },
      });
      button.position.set(index * (BUTTON_WIDTH + GAP), 0);
      return button;
    });

    for (const button of this.buttons) this.addChild(button);
  }

  public SetEnabled(enabled: boolean): void {
    for (const button of this.buttons) button.SetEnabled(enabled);
  }
}
