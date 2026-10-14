// 게임방에서 한 명의 사용자 정보(아바타/아이디/별명/승율)를 보여주는 패널. 게임 종류와 무관해서 공통 UI 에 둔다.
import { Container, Graphics, Text } from "pixi.js";
import type { RoomPlayerInfo } from "../common/types";
import { DEFAULT_UI_THEME, type UiTheme } from "./UiTheme";

export const AVATAR_SIZE = 160;
const FONT_SIZE = 16;
// 명칭과 실제 데이터 사이 간격.
const LABEL_GAP = 8;

// 아바타 이미지가 아직 없어서, 아바타 코드를 사각형 안에 그대로 표기한다.
export class PlayerPanel extends Container {
  private readonly avatar_label: Text;
  private readonly userid_text: Text;
  private readonly name_text: Text;
  private readonly win_per_text: Text;
  private readonly note_text: Text;

  constructor(theme: UiTheme = DEFAULT_UI_THEME) {
    super();

    const avatar_box = new Graphics().roundRect(0, 0, AVATAR_SIZE, AVATAR_SIZE, 12).fill(theme.avatar_color);

    this.avatar_label = new Text({
      text: "-",
      style: { fill: theme.avatar_text_color, fontSize: 18, fontFamily: theme.content_font_family },
    });
    this.avatar_label.anchor.set(0.5);
    this.avatar_label.position.set(AVATAR_SIZE / 2, AVATAR_SIZE / 2);

    // 명칭은 굵게 + 데이터와 다른 색으로 표기한다.
    const label_style = { fill: theme.label_color, fontSize: FONT_SIZE, fontFamily: theme.font_family, fontWeight: "bold" } as const;
    const value_style = { fill: theme.value_color, fontSize: FONT_SIZE, fontFamily: theme.font_family } as const;

    const labels = ["아이디", "별명", "승율"].map((label) => new Text({ text: label, style: label_style }));
    // 데이터는 가장 긴 명칭 뒤에 줄을 맞춰 놓는다.
    const value_x = Math.max(...labels.map((label) => label.width)) + LABEL_GAP;

    this.userid_text = new Text({ text: "-", style: value_style });
    this.name_text = new Text({ text: "-", style: value_style });
    this.win_per_text = new Text({ text: "-", style: value_style });
    // 게임별로 덧붙이는 한 줄 표기(예: 오델로의 돌 색). 쓰지 않는 게임에서는 비어 있다.
    this.note_text = new Text({ text: "", style: { ...value_style, fill: theme.accent_color } });

    const rows = [this.userid_text, this.name_text, this.win_per_text];
    rows.forEach((value_text, index) => {
      const y = AVATAR_SIZE + 16 + index * 24;
      labels[index].position.set(0, y);
      value_text.position.set(value_x, y);
    });
    this.note_text.position.set(0, AVATAR_SIZE + 16 + 72);

    this.addChild(avatar_box, this.avatar_label, ...labels, ...rows, this.note_text);
  }

  // 표기 순서: 아이디(userid), 별명(name), 승율(win_per)
  public SetInfo(info: RoomPlayerInfo): void {
    this.avatar_label.text = info.avatar;
    this.userid_text.text = info.userid;
    this.name_text.text = info.name;
    this.win_per_text.text = `${info.win_per}%`;
  }

  // GAME_RESULT 는 userid/win_count/win_per 만 주고 name/avatar 는 없어서, win_per 만 따로 갱신한다.
  public UpdateWinPer(win_per: number): void {
    this.win_per_text.text = `${win_per}%`;
  }

  public SetNote(note: string): void {
    this.note_text.text = note;
  }
}
