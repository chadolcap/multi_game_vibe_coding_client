// 가위바위보 화면 가운데 오리 캐릭터 — 평소엔 깃발을 내린 채 통통 튀고, 한 판 결과가 나오면 이긴 사람 쪽 깃발을 든 그림으로 바꾼다.
// 그림은 시트 이미지(duck_flags.png, 9프레임) 한 장에서 잘라 쓴다. 프레임 위치는 duck_flags.json 의 frames[].frame 을 따른다.
// 화면 왼쪽 파란 깃발 = 상대 카드 쪽, 오른쪽 주황 깃발 = 내 카드 쪽이다(RpsScene 카드 배치와 맞춘다).
// 최종 결과 때는 승자 쪽 깃발을 든 채, 승자 별명을 쓴 플랜카드를 가슴 앞에 들고 깡충깡충 뛴다.
// 좌표 기준점(0,0)은 오리 발 가운데다.
import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, Ticker } from "pixi.js";
import { CUTE_COLOR, CUTE_FONT_FAMILY } from "../../ui/CuteTheme";
import type { DuckFlagSide } from "../../ui/DuckMascot";
import duck_sheet_url from "../../assets/images/sheet/duck_flags.png";
import duck_sheet_info from "../../assets/images/sheet/duck_flags.json";

// 쓰는 그림 종류.
type DuckPose = "duck_flags_down" | "duck_blue_flag_up" | "duck_orange_flag_up" | "duck_both_flags_up";

// 그림 → duck_flags.json 의 frames 키. 파일명의 right/left 는 오리 기준 손이다(오리 오른손 = 파란 깃발 = 화면 왼쪽).
const POSE_FRAME: Record<DuckPose, string> = {
  duck_flags_down: "03_right-down_left-down.png",
  duck_blue_flag_up: "04_right-up_left-down.png",
  duck_orange_flag_up: "06_right-down_left-up.png",
  duck_both_flags_up: "01_right-up_left_up.png",
};
// 프레임 안 오리 발 가운데 좌표(px)를 기준점으로 쓴다(json pivot 은 프레임 가운데라 쓰지 않는다).
// duck_flags.png 에서 잰 값이다 — 9프레임 모두 같은 자리에 서 있다. 그림을 바꾸면 다시 재야 한다.
const DUCK_FEET = { x: 164, y: 249 };
// 시트 속 오리 높이(머리 깃털 ~ 발끝, px) — 모든 프레임이 같다.
const SHEET_DUCK_HEIGHT = 247;

// 화면에 보일 오리 높이.
const DUCK_HEIGHT = 270;

const BOUNCE_PX = 6;
const BOUNCE_PERIOD_MS = 1400;
// 결과가 나올 때 깡충 뛰는 높이/한 번 뛰는 시간/횟수.
const HOP_PX = 26;
const HOP_MS = 360;
const HOP_COUNT = 2;
// 깃발을 들 때 그림이 톡 튀어 커졌다 돌아오는 시간.
const POSE_POP_MS = 260;
const POSE_POP_SCALE = 0.08;
const LABEL_POP_MS = 320;

// 플랜카드 — 오리 머리 위는 사용자 정보 카드와 겹쳐서 가슴 앞에 그린다.
const PLACARD_WIDTH = 290;
const PLACARD_HEIGHT = 96;
// 플랜카드 가운데 높이(발 기준).
const PLACARD_Y = -110 + PLACARD_HEIGHT / 2;
// 별명이 이 폭을 넘으면 글자를 줄인다.
const PLACARD_TEXT_WIDTH = PLACARD_WIDTH - 70;
const PLACARD_POP_MS = 420;

export class RpsFlagDuck extends Container {
  private readonly body = new Container();
  private readonly sprite = new Sprite(Texture.EMPTY);
  // 시트에서 잘라 둔 그림. 시트를 불러오기 전에는 비어 있다.
  private readonly pose_textures = new Map<DuckPose, Texture>();
  private pose: DuckPose = "duck_flags_down";
  private pose_elapsed_ms = Number.POSITIVE_INFINITY;
  private readonly result_text: Text;
  private readonly placard = new Container();
  private readonly placard_name: Text;
  private readonly placard_ribbon: Text;
  private placard_elapsed_ms = Number.POSITIVE_INFINITY;
  private elapsed_ms = 0;
  // 깡충 뛰기 진행 시간 — hop_count 번을 다 뛰면(HOP_MS * hop_count 를 넘으면) 뛰기가 끝난 것.
  private hop_elapsed_ms = Number.POSITIVE_INFINITY;
  // 이번에 뛸 횟수 — 최종 결과 때는 Reset() 전까지 계속 뛴다(무한대).
  private hop_count = HOP_COUNT;
  private result_elapsed_ms = Number.POSITIVE_INFINITY;

  constructor() {
    super();

    this.sprite.scale.set(DUCK_HEIGHT / SHEET_DUCK_HEIGHT);
    Assets.load<Texture>(duck_sheet_url).then((sheet) => {
      // 불러오는 사이에 씬이 파괴됐을 수 있다.
      if (this.sprite.destroyed) return;
      this.SliceSheet(sheet);
      // 불러오기 전에 결과가 왔다면 그 그림으로 바로 보여준다.
      this.ApplyPose();
    });

    this.result_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.red,
        fontSize: 44,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 8, join: "round" },
      },
    });
    this.result_text.anchor.set(0.5, 1);
    this.result_text.position.set(0, -DUCK_HEIGHT - 6);
    this.result_text.visible = false;

    [this.placard_name, this.placard_ribbon] = this.BuildPlacard();

    // 플랜카드는 몸 앞에 들고 있으므로 오리 위에 놓는다.
    this.body.addChild(this.sprite, this.placard);
    this.addChild(this.body, this.result_text);

    this.Reset();
    Ticker.shared.add(this.OnTick);
  }

  // 한 판 결과 — winner 쪽 깃발을 든 그림으로 바꾼다. null 이면 무승부(양쪽 깃발을 든다).
  public ShowRoundResult(winner: DuckFlagSide | null, label: string, label_color: number): void {
    this.SetPose(winner === null ? "duck_both_flags_up" : winner === "left" ? "duck_blue_flag_up" : "duck_orange_flag_up");
    this.hop_elapsed_ms = 0;
    this.hop_count = HOP_COUNT;

    this.result_text.text = label;
    this.result_text.style.fill = label_color;
    this.result_text.visible = true;
    this.result_elapsed_ms = 0;
  }

  // 최종 결과 — 승자 쪽 깃발(무승부면 양쪽)을 든 채 승자 별명을 쓴 플랜카드를 들고, 다음 게임/퇴장(Reset) 전까지 계속 깡충깡충 뛴다.
  // ribbon 은 플랜카드 위 리본 문구(무승부면 "DRAW" 처럼 바꿔 쓴다).
  public ShowFinalResult(winner: DuckFlagSide | null, winner_name: string, label: string, label_color: number, ribbon = "WINNER"): void {
    this.ShowRoundResult(winner, label, label_color);
    this.hop_count = Number.POSITIVE_INFINITY;

    this.placard_name.text = winner_name;
    this.placard_ribbon.text = ribbon;
    this.placard_name.scale.set(1);
    if (this.placard_name.width > PLACARD_TEXT_WIDTH) {
      this.placard_name.scale.set(PLACARD_TEXT_WIDTH / this.placard_name.width);
    }
    this.placard.visible = true;
    this.placard_elapsed_ms = 0;
  }

  // 결과 표시를 거두고 깃발을 내린 그림으로 돌아간다.
  public Reset(): void {
    this.hop_count = 0;
    this.SetPose("duck_flags_down");
    this.result_text.visible = false;
    this.placard.visible = false;
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  // duck_flags.json 의 frames 좌표대로 쓰는 그림만 잘라 둔다.
  private SliceSheet(sheet: Texture): void {
    const frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = duck_sheet_info.frames;
    for (const pose of Object.keys(POSE_FRAME) as DuckPose[]) {
      const info = frames[POSE_FRAME[pose]];
      if (!info) continue;
      const frame = new Rectangle(info.frame.x, info.frame.y, info.frame.w, info.frame.h);
      this.pose_textures.set(pose, new Texture({ source: sheet.source, frame }));
    }
  }

  // 같은 그림이면 다시 튀지 않는다(재접속 등으로 같은 결과가 두 번 와도 자연스럽게).
  private SetPose(pose: DuckPose): void {
    if (this.pose === pose) return;
    this.pose = pose;
    // 깃발을 내릴 때는 튀지 않고 바로 바꾼다.
    this.pose_elapsed_ms = pose === "duck_flags_down" ? Number.POSITIVE_INFINITY : 0;
    this.ApplyPose();
  }

  private ApplyPose(): void {
    const texture = this.pose_textures.get(this.pose);
    if (!texture) return;
    this.sprite.texture = texture;
    this.sprite.anchor.set(DUCK_FEET.x / texture.width, DUCK_FEET.y / texture.height);
  }

  private readonly OnTick = (ticker: Ticker): void => {
    const delta_ms = ticker.deltaMS;
    this.elapsed_ms += delta_ms;

    // 결과가 나오면 깡충깡충, 평소엔 제자리에서 작게 통통.
    if (this.hop_elapsed_ms < HOP_MS * this.hop_count) {
      this.hop_elapsed_ms += delta_ms;
      this.body.y = -Math.abs(Math.sin((Math.PI * this.hop_elapsed_ms) / HOP_MS)) * HOP_PX;
    } else {
      const phase = (this.elapsed_ms / BOUNCE_PERIOD_MS) * Math.PI * 2;
      this.body.y = -Math.abs(Math.sin(phase)) * BOUNCE_PX;
    }

    // 깃발을 드는 순간 그림이 살짝 커졌다 돌아온다.
    if (this.pose_elapsed_ms < POSE_POP_MS) {
      this.pose_elapsed_ms += delta_ms;
      const t = Math.min(1, this.pose_elapsed_ms / POSE_POP_MS);
      this.body.scale.set(1 + Math.sin(Math.PI * t) * POSE_POP_SCALE);
    } else {
      this.body.scale.set(1);
    }

    // 결과 문구는 툭 튀어나오듯(살짝 커졌다 제자리) 등장한다.
    if (this.result_elapsed_ms < LABEL_POP_MS) {
      this.result_elapsed_ms += delta_ms;
      this.result_text.scale.set(EaseOutBack(Math.min(1, this.result_elapsed_ms / LABEL_POP_MS)));
    }

    // 플랜카드는 툭 튀어나온 뒤 신나게 좌우로 흔든다.
    if (this.placard.visible) {
      if (this.placard_elapsed_ms < PLACARD_POP_MS) {
        this.placard_elapsed_ms += delta_ms;
        this.placard.scale.set(EaseOutBack(Math.min(1, this.placard_elapsed_ms / PLACARD_POP_MS)));
      }
      this.placard.rotation = Math.sin(this.elapsed_ms * 0.006) * 0.07;
    }
  };

  // 플랜카드: 크림색 천 + 빨간 테두리, 위쪽 "WINNER" 리본, 양옆 별, 가운데 승자 별명.
  // 기준점(0,0)이 천 가운데라 rotation 으로 흔든다. [별명 Text, 리본 Text] 를 돌려준다.
  private BuildPlacard(): [Text, Text] {
    const half_w = PLACARD_WIDTH / 2;
    const half_h = PLACARD_HEIGHT / 2;
    this.placard.position.set(0, PLACARD_Y);
    this.placard.visible = false;

    const cloth = new Graphics()
      // 아래쪽 그림자
      .roundRect(-half_w, -half_h + 6, PLACARD_WIDTH, PLACARD_HEIGHT, 16)
      .fill({ color: 0x000000, alpha: 0.12 })
      .roundRect(-half_w, -half_h, PLACARD_WIDTH, PLACARD_HEIGHT, 16)
      .fill(CUTE_COLOR.cream)
      .stroke({ color: CUTE_COLOR.red, width: 5 })
      .roundRect(-half_w + 8, -half_h + 8, PLACARD_WIDTH - 16, PLACARD_HEIGHT - 16, 10)
      .stroke({ color: CUTE_COLOR.yellow, width: 2 })
      .star(-half_w + 24, 6, 5, 13, 6)
      .star(half_w - 24, 6, 5, 13, 6)
      .fill(CUTE_COLOR.yellow);

    const ribbon = new Graphics().roundRect(-56, -half_h - 16, 112, 30, 15).fill(CUTE_COLOR.red);
    const ribbon_text = new Text({
      text: "WINNER",
      style: { fill: 0xffffff, fontSize: 18, fontFamily: CUTE_FONT_FAMILY },
    });
    ribbon_text.anchor.set(0.5);
    ribbon_text.position.set(0, -half_h - 1);

    const name_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.brown,
        fontSize: 36,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 4, join: "round" },
      },
    });
    name_text.anchor.set(0.5);
    name_text.position.set(0, 10);

    this.placard.addChild(cloth, ribbon, ribbon_text, name_text);
    return [name_text, ribbon_text];
  }
}

// 목표값을 살짝 넘었다가 돌아오는 이징(0~1).
function EaseOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
