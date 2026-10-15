// 게임방에서 한 명의 사용자 정보(아바타/아이디/별명/승율)를 보여주는 패널. 게임 종류와 무관해서 공통 UI 에 둔다.
import { Container, Graphics, Text } from "pixi.js";
import type { RoomPlayerInfo } from "../common/types";
import type { UiTheme } from "./UiTheme";

export const AVATAR_SIZE = 160;
const FONT_SIZE = 16;
// 명칭과 실제 데이터 사이 간격.
const LABEL_GAP = 8;
// 가로 배치에서 아바타와 글자 사이 간격.
const HORIZONTAL_GAP = 14;

// 패널 배치 옵션 — 생략하면 다른 게임과 같은 세로 배치(아바타 위, 글자 아래)다.
// 에어하키처럼 위쪽 공간이 좁은 화면은 horizontal 로 아바타를 왼쪽, 글자를 오른쪽에 둔다.
export interface PlayerPanelLayout {
  horizontal?: boolean;
  avatar_size?: number;
  font_size?: number;
  // 데이터 글자가 이 폭을 넘으면 가로로 줄여서 맞춘다(긴 아이디/별명이 카드 밖으로 나가지 않게).
  value_max_width?: number;
}

// 아바타 이미지가 아직 없어서, 아바타 코드를 사각형 안에 그대로 표기한다.
export class PlayerPanel extends Container {
  private readonly avatar_label: Text;
  private readonly userid_text: Text;
  private readonly name_text: Text;
  private readonly win_per_text: Text;
  private readonly note_text: Text;
  private readonly value_max_width: number;

  constructor(theme: UiTheme, layout: PlayerPanelLayout = {}) {
    super();

    const avatar_size = layout.avatar_size ?? AVATAR_SIZE;
    const font_size = layout.font_size ?? FONT_SIZE;
    const line_height = font_size + 8;
    this.value_max_width = layout.value_max_width ?? Infinity;

    const avatar_box = new Graphics().roundRect(0, 0, avatar_size, avatar_size, 12).fill(theme.avatar_color);

    this.avatar_label = new Text({
      text: "-",
      style: { fill: theme.avatar_text_color, fontSize: 18, fontFamily: theme.content_font_family },
    });
    this.avatar_label.anchor.set(0.5);
    this.avatar_label.position.set(avatar_size / 2, avatar_size / 2);

    // 명칭은 굵게 + 데이터와 다른 색으로 표기한다.
    const label_style = { fill: theme.label_color, fontSize: font_size, fontFamily: theme.font_family, fontWeight: "bold" } as const;
    const value_style = { fill: theme.value_color, fontSize: font_size, fontFamily: theme.font_family } as const;

    const labels = ["아이디", "별명", "승율"].map((label) => new Text({ text: label, style: label_style }));
    // 데이터는 가장 긴 명칭 뒤에 줄을 맞춰 놓는다.
    const value_x = Math.max(...labels.map((label) => label.width)) + LABEL_GAP;

    this.userid_text = new Text({ text: "-", style: value_style });
    this.name_text = new Text({ text: "-", style: value_style });
    this.win_per_text = new Text({ text: "-", style: value_style });
    // 게임별로 덧붙이는 한 줄 표기(예: 오델로의 돌 색). 쓰지 않는 게임에서는 비어 있다.
    this.note_text = new Text({ text: "", style: { ...value_style, fill: theme.accent_color } });

    const rows = [this.userid_text, this.name_text, this.win_per_text];
    // 세로 배치: 아바타 아래에 줄을 쌓는다. 가로 배치: 아바타 오른쪽에 세 줄을 아바타 높이 가운데로 맞춘다.
    const text_x = layout.horizontal ? avatar_size + HORIZONTAL_GAP : 0;
    const text_y = layout.horizontal ? (avatar_size - line_height * rows.length) / 2 + 4 : avatar_size + 16;
    rows.forEach((value_text, index) => {
      const y = text_y + index * line_height;
      labels[index].position.set(text_x, y);
      value_text.position.set(text_x + value_x, y);
    });
    this.note_text.position.set(text_x, text_y + rows.length * line_height);

    this.addChild(avatar_box, this.avatar_label, ...labels, ...rows, this.note_text);
  }

  // 표기 순서: 아이디(userid), 별명(name), 승율(win_per)
  public SetInfo(info: RoomPlayerInfo): void {
    this.avatar_label.text = info.avatar;
    this.userid_text.text = info.userid;
    this.name_text.text = info.name;
    this.win_per_text.text = `${info.win_per}%`;
    for (const value_text of [this.userid_text, this.name_text, this.win_per_text]) this.FitValueWidth(value_text);
  }

  // value_max_width 를 넘는 글자는 가로로만 줄인다(기본값 Infinity 면 아무것도 하지 않는다).
  private FitValueWidth(value_text: Text): void {
    value_text.scale.x = 1;
    if (value_text.width > this.value_max_width) value_text.scale.x = this.value_max_width / value_text.width;
  }

  // GAME_RESULT 는 userid/win_count/win_per 만 주고 name/avatar 는 없어서, win_per 만 따로 갱신한다.
  public UpdateWinPer(win_per: number): void {
    this.win_per_text.text = `${win_per}%`;
    this.FitValueWidth(this.win_per_text);
  }

  public SetNote(note: string): void {
    this.note_text.text = note;
  }
}
