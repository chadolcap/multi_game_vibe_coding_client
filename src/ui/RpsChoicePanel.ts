// 가위/바위/보 선택 버튼 3개를 가로로 배치한 패널.
import { Container } from "pixi.js";
import { Button } from "./Button";
import { RpsChoice } from "../common/types";

export interface RpsChoicePanelOptions {
  onSelect: (choice: RpsChoice) => void;
}

const BUTTON_WIDTH = 200;
const BUTTON_HEIGHT = 88;
const GAP = 20;
export const RPS_PANEL_WIDTH = BUTTON_WIDTH * 3 + GAP * 2;

export class RpsChoicePanel extends Container {
  private readonly buttons: Button[];

  constructor(options: RpsChoicePanelOptions) {
    super();

    const choices: RpsChoice[] = [RpsChoice.SCISSORS, RpsChoice.ROCK, RpsChoice.PAPER];
    this.buttons = choices.map((choice, index) => {
      const button = new Button({
        label: choice,
        width: BUTTON_WIDTH,
        height: BUTTON_HEIGHT,
        onClick: () => {
          this.SetEnabled(false);
          options.onSelect(choice);
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
