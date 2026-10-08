// 게임방에서 한 명의 사용자 정보(아바타/userid/name/win_per)를 보여주는 패널. 게임 종류와 무관해서 공통 UI 에 둔다.
import { Container, Graphics, Text } from "pixi.js";
import type { RoomPlayerInfo } from "../common/types";

export const AVATAR_SIZE = 160;
const TEXT_STYLE = { fill: 0xeaeaea, fontSize: 16, fontFamily: "sans-serif" } as const;

// 아바타 이미지가 아직 없어서, 아바타 코드를 사각형 안에 그대로 표기한다.
export class PlayerPanel extends Container {
  private readonly avatar_label: Text;
  private readonly userid_text: Text;
  private readonly name_text: Text;
  private readonly win_per_text: Text;
  private readonly note_text: Text;

  constructor() {
    super();

    const avatar_box = new Graphics().roundRect(0, 0, AVATAR_SIZE, AVATAR_SIZE, 12).fill(0x2c2f4a);

    this.avatar_label = new Text({ text: "-", style: { fill: 0xffffff, fontSize: 18, fontFamily: "monospace" } });
    this.avatar_label.anchor.set(0.5);
    this.avatar_label.position.set(AVATAR_SIZE / 2, AVATAR_SIZE / 2);

    this.userid_text = new Text({ text: "userid: -", style: TEXT_STYLE });
    this.name_text = new Text({ text: "name: -", style: TEXT_STYLE });
    this.win_per_text = new Text({ text: "win_per: -", style: TEXT_STYLE });
    // 게임별로 덧붙이는 한 줄 표기(예: 오델로의 돌 색). 쓰지 않는 게임에서는 비어 있다.
    this.note_text = new Text({ text: "", style: { ...TEXT_STYLE, fill: 0xffd257 } });

    this.userid_text.position.set(0, AVATAR_SIZE + 16);
    this.name_text.position.set(0, AVATAR_SIZE + 16 + 24);
    this.win_per_text.position.set(0, AVATAR_SIZE + 16 + 48);
    this.note_text.position.set(0, AVATAR_SIZE + 16 + 72);

    this.addChild(avatar_box, this.avatar_label, this.userid_text, this.name_text, this.win_per_text, this.note_text);
  }

  // 표기 순서: userid, name, win_per
  public SetInfo(info: RoomPlayerInfo): void {
    this.avatar_label.text = info.avatar;
    this.userid_text.text = `userid: ${info.userid}`;
    this.name_text.text = `name: ${info.name}`;
    this.win_per_text.text = `win_per: ${info.win_per}`;
  }

  // GAME_RESULT 는 userid/win_count/win_per 만 주고 name/avatar 는 없어서, win_per 만 따로 갱신한다.
  public UpdateWinPer(win_per: number): void {
    this.win_per_text.text = `win_per: ${win_per}`;
  }

  public SetNote(note: string): void {
    this.note_text.text = note;
  }
}
