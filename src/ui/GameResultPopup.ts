// 최종 게임 결과 팝업 — 재시작 / 나가기 버튼 포함.
import { Container, Graphics, Text } from "pixi.js";
import { Button } from "./Button";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";
import { DEFAULT_UI_THEME, type UiTheme } from "./UiTheme";

export interface GameResultPopupOptions {
  onReplay: () => void;
  onExit: () => void;
  theme?: UiTheme;
  // 팝업 크기/위치 — 지정하지 않으면 화면 가운데 큰 팝업(DEFAULT_RESULT_POPUP_LAYOUT).
  layout?: Partial<GameResultPopupLayout>;
}

export interface GameResultPopupLayout {
  panel_width: number;
  panel_height: number;
  // 패널 위쪽 y. null 이면 화면 세로 가운데.
  panel_y: number | null;
  button_height: number;
  // 뒤쪽 화면을 어둡게 덮는 정도. null 이면 테마의 dim_alpha.
  dim_alpha: number | null;
}

// 게임 씬의 결과 화면에서 뒤쪽 게임 화면 전체를 덮는 옅은 검정 덮개의 진하기 — 게임 화면과 결과 화면이
// 분리돼 보이게 한다. 가위바위보/오델로/점핑이 같은 값을 쓴다(오리·색종이는 덮개 위에 그려서 밝게 남긴다).
export const RESULT_SCREEN_DIM_ALPHA = 0.4;

export const DEFAULT_RESULT_POPUP_LAYOUT: GameResultPopupLayout = {
  panel_width: 600,
  panel_height: 480,
  panel_y: null,
  button_height: 64,
  dim_alpha: null,
};

export class GameResultPopup extends Container {
  private readonly content: Text;
  private readonly replay_button: Button;
  private readonly exit_button: Button;

  constructor(options: GameResultPopupOptions) {
    super();
    this.visible = false;
    const theme = options.theme ?? DEFAULT_UI_THEME;
    const layout = { ...DEFAULT_RESULT_POPUP_LAYOUT, ...options.layout };
    const panel_width = layout.panel_width;
    const panel_height = layout.panel_height;
    const panel_x = (GAME_WIDTH - panel_width) / 2;
    const panel_y = layout.panel_y ?? (GAME_HEIGHT - panel_height) / 2;
    const content_x = panel_x + 40;
    const content_width = panel_width - 80;
    const button_height = layout.button_height;
    // 기본(큰) 팝업은 제목/본문 사이를 넉넉히, 작은 팝업은 촘촘하게 둔다.
    const is_compact = panel_height < DEFAULT_RESULT_POPUP_LAYOUT.panel_height;

    const dim = new Graphics()
      .rect(0, 0, GAME_WIDTH, GAME_HEIGHT)
      .fill({ color: 0x000000, alpha: layout.dim_alpha ?? theme.dim_alpha });
    dim.eventMode = "static"; // 뒤쪽 UI 클릭 차단(모달)

    const panel = new Graphics()
      .roundRect(panel_x, panel_y, panel_width, panel_height, theme.panel_radius)
      .fill(theme.panel_color);
    if (theme.panel_border_color !== null) panel.stroke({ color: theme.panel_border_color, width: 6 });

    const title = new Text({
      text: "게임 결과",
      style: { fill: theme.title_color, fontSize: 28, fontFamily: theme.font_family, fontWeight: "bold" },
    });
    title.anchor.set(0.5, 0);
    title.position.set(GAME_WIDTH / 2, panel_y + (is_compact ? 20 : 32));

    this.content = new Text({
      text: "",
      style: {
        fill: theme.text_color,
        fontSize: 18,
        fontFamily: theme.content_font_family,
        wordWrap: true,
        wordWrapWidth: content_width,
        lineHeight: 28,
        align: "center",
      },
    });
    this.content.anchor.set(0.5, 0);
    this.content.position.set(GAME_WIDTH / 2, panel_y + (is_compact ? 64 : 110));

    this.replay_button = new Button({
      label: "재시작",
      width: content_width,
      height: button_height,
      theme,
      onClick: () => {
        this.DisableButtons();
        options.onReplay();
      },
    });
    this.replay_button.position.set(content_x, panel_y + panel_height - button_height * 2 - 24 - 16);

    this.exit_button = new Button({
      label: "나가기",
      width: content_width,
      height: button_height,
      theme,
      onClick: () => {
        this.DisableButtons();
        options.onExit();
      },
    });
    this.exit_button.position.set(content_x, panel_y + panel_height - button_height - 24);

    this.addChild(dim, panel, title, this.content, this.replay_button, this.exit_button);
  }

  public Show(content: string): void {
    this.content.text = content;
    this.replay_button.SetEnabled(true);
    this.exit_button.SetEnabled(true);
    this.visible = true;
  }

  public Hide(): void {
    this.visible = false;
  }

  public DisableButtons(): void {
    this.replay_button.SetEnabled(false);
    this.exit_button.SetEnabled(false);
  }
}
