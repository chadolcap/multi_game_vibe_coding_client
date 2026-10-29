// 청기백기 화면 가운데 오리 — 청기/백기 두 깃발의 올림·정지·내림 상태(3×3 = 9가지)에 맞는 그림을 보여준다.
// 그림은 시트 이미지(duck_flags.png, 9프레임) 한 장에서 잘라 쓴다. 프레임 위치는 duck_flags.json 의 frames[].frame 을 따른다.
// 화면 왼쪽 청기 = 오리 오른손이다(오리 기준 손 방향과 같은 그림).
// 정지(0, 깃발 수평)는 그 깃발 버튼을 아직 안 누른 상태다 — 정지 문제는 버튼 없이 안 누르는 것으로 답한다.
// 좌표 기준점(0,0)은 오리 발 가운데다.
import { Assets, Container, Rectangle, Sprite, Text, Texture, Ticker } from "pixi.js";
import { CUTE_COLOR, CUTE_FONT_FAMILY } from "../../ui/CuteTheme";
import { FLAG_KEEP, type FlagMove } from "./types";
import duck_sheet_url from "../../assets/images/sheet/duck_flags.png";
import duck_sheet_info from "../../assets/images/sheet/duck_flags.json";

// 그림 = duck_flags.json 의 frames 키.
type DuckPose = string;
// [청기 값][백기 값] → 그림. 파일명의 right/left 는 오리 기준 손이다(right = 청기, left = 백기). up=1, stop=0, down=-1.
const POSE_TABLE: Record<FlagMove, Record<FlagMove, DuckPose>> = {
  [1]: {
    [1]: "01_right-up_left_up.png",
    [0]: "05_right-up_left-stop.png",
    [-1]: "04_right-up_left-down.png",
  },
  [0]: {
    [1]: "08_right-stop_left-up.png",
    [0]: "02_right-stop_left_stop.png",
    [-1]: "09_right-stop_left-down.png",
  },
  [-1]: {
    [1]: "06_right-down_left-up.png",
    [0]: "07_right-down_left-stop.png",
    [-1]: "03_right-down_left-down.png",
  },
};
const POSES: DuckPose[] = Object.values(POSE_TABLE).flatMap((row) => Object.values(row));
const POSE_BOTH_KEEP = POSE_TABLE[FLAG_KEEP][FLAG_KEEP];

// 프레임 안 오리 발 가운데 좌표(px)를 기준점으로 쓴다(json 에는 기준점 정보가 없다).
// duck_flags.png(2026-10-29 교체본, 998x788)에서 잰 값이다 — 9프레임 모두 같은 자리에 서 있다. 그림을 바꾸면 다시 재야 한다.
const DUCK_FEET = { x: 163, y: 249 };
// 시트 속 오리 높이(머리 깃털 ~ 발끝, px).
const SHEET_DUCK_HEIGHT = 247;

// 화면에 보일 오리 높이.
export const FLAG_DUCK_HEIGHT = 280;

const BOUNCE_PX = 5;
const BOUNCE_PERIOD_MS = 1400;
// 깃발을 바꿀 때 그림이 톡 튀어 커졌다 돌아오는 시간.
const POSE_POP_MS = 220;
const POSE_POP_SCALE = 0.06;
// 정답일 때 깡충 뛰는 높이/한 번 뛰는 시간/횟수.
const HOP_PX = 24;
const HOP_MS = 340;
const HOP_COUNT = 2;
// 오답일 때 좌우로 도리도리 흔드는 시간/폭.
const SHAKE_MS = 420;
const SHAKE_PX = 12;
const LABEL_POP_MS = 320;

export class FlagDuck extends Container {
  private readonly body = new Container();
  private readonly sprite = new Sprite(Texture.EMPTY);
  // 시트에서 잘라 둔 그림. 시트를 불러오기 전에는 비어 있다.
  private readonly pose_textures = new Map<DuckPose, Texture>();
  private pose: DuckPose = POSE_BOTH_KEEP;
  private pose_elapsed_ms = Number.POSITIVE_INFINITY;
  private readonly result_text: Text;
  private result_elapsed_ms = Number.POSITIVE_INFINITY;
  private elapsed_ms = 0;
  private hop_elapsed_ms = Number.POSITIVE_INFINITY;
  private shake_elapsed_ms = Number.POSITIVE_INFINITY;

  constructor() {
    super();

    this.sprite.scale.set(FLAG_DUCK_HEIGHT / SHEET_DUCK_HEIGHT);
    Assets.load<Texture>(duck_sheet_url).then((sheet) => {
      // 불러오는 사이에 씬이 파괴됐을 수 있다.
      if (this.sprite.destroyed) return;
      this.SliceSheet(sheet);
      this.ApplyPose();
    });

    this.result_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.red,
        fontSize: 52,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 9, join: "round" },
      },
    });
    this.result_text.anchor.set(0.5, 1);
    this.result_text.position.set(0, -FLAG_DUCK_HEIGHT - 10);
    this.result_text.visible = false;

    this.body.addChild(this.sprite);
    this.addChild(this.body, this.result_text);
    Ticker.shared.add(this.OnTick);
  }

  // 두 깃발의 상태를 그림으로 보여준다(1 = 올림, 0 = 정지(수평), -1 = 내림).
  public SetFlags(blue: FlagMove, white: FlagMove): void {
    const pose = POSE_TABLE[blue][white];
    if (this.pose === pose) return;
    this.pose = pose;
    this.pose_elapsed_ms = 0;
    this.ApplyPose();
  }

  // 한 문제 결과 — 정답이면 깡충깡충, 오답이면 도리도리 + 문구.
  public ShowResult(correct: boolean): void {
    this.result_text.text = correct ? "정답!" : "땡!";
    this.result_text.style.fill = correct ? CUTE_COLOR.red : CUTE_COLOR.shirt_dark;
    this.result_text.visible = true;
    this.result_elapsed_ms = 0;
    if (correct) this.hop_elapsed_ms = 0;
    else this.shake_elapsed_ms = 0;
  }

  // 결과 문구를 거두고 두 깃발을 정지(수평)로 돌린다(새 문제/새 게임).
  public Reset(): void {
    this.result_text.visible = false;
    this.hop_elapsed_ms = Number.POSITIVE_INFINITY;
    this.shake_elapsed_ms = Number.POSITIVE_INFINITY;
    this.SetFlags(FLAG_KEEP, FLAG_KEEP);
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  // duck_flags.json 의 frames 좌표대로 쓰는 그림만 잘라 둔다.
  private SliceSheet(sheet: Texture): void {
    const frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = duck_sheet_info.frames;
    for (const pose of POSES) {
      const info = frames[pose];
      if (!info) continue;
      const frame = new Rectangle(info.frame.x, info.frame.y, info.frame.w, info.frame.h);
      this.pose_textures.set(pose, new Texture({ source: sheet.source, frame }));
    }
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

    if (this.hop_elapsed_ms < HOP_MS * HOP_COUNT) {
      this.hop_elapsed_ms += delta_ms;
      this.body.y = -Math.abs(Math.sin((Math.PI * this.hop_elapsed_ms) / HOP_MS)) * HOP_PX;
    } else {
      const phase = (this.elapsed_ms / BOUNCE_PERIOD_MS) * Math.PI * 2;
      this.body.y = -Math.abs(Math.sin(phase)) * BOUNCE_PX;
    }

    if (this.shake_elapsed_ms < SHAKE_MS) {
      this.shake_elapsed_ms += delta_ms;
      const t = Math.min(1, this.shake_elapsed_ms / SHAKE_MS);
      this.body.x = Math.sin(t * Math.PI * 6) * SHAKE_PX * (1 - t);
    } else {
      this.body.x = 0;
    }

    // 깃발을 바꾸는 순간 그림이 살짝 커졌다 돌아온다.
    if (this.pose_elapsed_ms < POSE_POP_MS) {
      this.pose_elapsed_ms += delta_ms;
      const t = Math.min(1, this.pose_elapsed_ms / POSE_POP_MS);
      this.body.scale.set(1 + Math.sin(Math.PI * t) * POSE_POP_SCALE);
    } else {
      this.body.scale.set(1);
    }

    if (this.result_elapsed_ms < LABEL_POP_MS) {
      this.result_elapsed_ms += delta_ms;
      this.result_text.scale.set(EaseOutBack(Math.min(1, this.result_elapsed_ms / LABEL_POP_MS)));
    }
  };
}

// 목표값을 살짝 넘었다가 돌아오는 이징(0~1).
function EaseOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
