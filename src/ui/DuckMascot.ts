// 화면 가운데 오리 캐릭터 — 평소엔 제자리에서 통통 튀고, 한 판 결과가 나오면 이긴 사람 쪽 깃발을 들어 올린다.
// 왼쪽 깃발 = 상대 카드 쪽, 오른쪽 깃발 = 내 카드 쪽이다(각 게임 씬의 카드 배치와 맞춘다).
// 최종 결과 때는 깃발을 내려놓고, 승자 별명을 쓴 플랜카드를 두 손으로 들고 깡충깡충 뛴다.
// 좌표 기준점(0,0)은 오리 발 가운데다.
import { Container, Graphics, Sprite, Text, Texture, Ticker } from "pixi.js";
import { CUTE_COLOR, CUTE_FONT_FAMILY, LoadCuteTexture } from "./CuteTheme";
import duck_url from "../assets/images/duck.png";

export type DuckFlagSide = "left" | "right";

const DUCK_HEIGHT = 270;
// duck.png(230x333) 의 양 날개 끝을 발 가운데 기준 좌표로 옮긴 값 (DUCK_HEIGHT 로 줄인 크기 기준).
const HAND_X = 84;
const HAND_Y = -106;

const BOUNCE_PX = 6;
const BOUNCE_PERIOD_MS = 1400;
// 결과가 나올 때 깡충 뛰는 높이/한 번 뛰는 시간/횟수.
const HOP_PX = 26;
const HOP_MS = 360;
const HOP_COUNT = 2;
// 이긴 쪽으로 몸을 살짝 기울이는 각도(rad).
const LEAN = 0.07;

const POLE_LENGTH = 130;
// 깃발 각도(rad, 오른쪽 깃발 기준 — 왼쪽은 부호를 반대로 쓴다). 0 이면 똑바로 위.
const FLAG_LOWERED = 2.4;
const FLAG_RAISED = 0.3;
// 무승부 — 양쪽 깃발을 옆으로 쭉 편다.
const FLAG_DRAW = 1.35;
// 목표 각도로 따라가는 속도(1ms 당 비율).
const FLAG_EASE = 0.012;
const LABEL_POP_MS = 320;

// 플랜카드 — 오리 머리 위는 사용자 정보 카드와 겹쳐서, 가슴 앞에 두 손(날개 끝)으로 들고 있는 모양으로 그린다.
const PLACARD_WIDTH = 290;
const PLACARD_HEIGHT = 96;
// 플랜카드 가운데 높이(발 기준). 위쪽 모서리가 날개 끝(HAND_Y) 높이에 오게 한다.
const PLACARD_Y = HAND_Y + PLACARD_HEIGHT / 2 - 8;
// 별명이 이 폭을 넘으면 글자를 줄인다.
const PLACARD_TEXT_WIDTH = PLACARD_WIDTH - 70;
const PLACARD_POP_MS = 420;

interface Flag {
  root: Container;
  cloth: Graphics;
  // 바깥쪽 방향 — 왼쪽 깃발 -1, 오른쪽 깃발 1.
  outward: -1 | 1;
  target: number;
  raised: boolean;
}

export class DuckMascot extends Container {
  private readonly body = new Container();
  private readonly sprite = new Sprite(Texture.EMPTY);
  private readonly left_flag: Flag;
  private readonly right_flag: Flag;
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
  private lean_target = 0;

  constructor() {
    super();

    this.sprite.anchor.set(0.5, 1);
    LoadCuteTexture(duck_url).then((texture) => {
      // 불러오는 사이에 씬이 파괴됐을 수 있다.
      if (this.sprite.destroyed) return;
      this.sprite.texture = texture;
      this.sprite.height = DUCK_HEIGHT;
      this.sprite.scale.x = this.sprite.scale.y;
    });

    this.left_flag = this.CreateFlag(CUTE_COLOR.shirt_dark, -1);
    this.right_flag = this.CreateFlag(CUTE_COLOR.orange, 1);

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

    // 깃대 아래쪽이 날개 뒤로 들어가 손에 쥔 것처럼 보이도록 깃발을 오리보다 먼저(뒤에) 놓는다.
    // 플랜카드는 몸 앞에 들고 있으므로 오리 위에 놓는다.
    this.body.addChild(this.left_flag.root, this.right_flag.root, this.sprite, this.placard);
    this.addChild(this.body, this.result_text);

    this.Reset();
    for (const flag of [this.left_flag, this.right_flag]) flag.root.rotation = flag.target;
    Ticker.shared.add(this.OnTick);
  }

  // 한 판 결과 — winner 쪽 깃발을 들고 그쪽으로 몸을 기울인다. null 이면 무승부(양쪽 깃발을 옆으로).
  public ShowRoundResult(winner: DuckFlagSide | null, label: string, label_color: number): void {
    this.SetFlag(this.left_flag, winner === null ? FLAG_DRAW : winner === "left" ? FLAG_RAISED : FLAG_LOWERED, winner === "left");
    this.SetFlag(this.right_flag, winner === null ? FLAG_DRAW : winner === "right" ? FLAG_RAISED : FLAG_LOWERED, winner === "right");
    this.lean_target = winner === null ? 0 : winner === "left" ? -LEAN : LEAN;
    this.hop_elapsed_ms = 0;
    this.hop_count = HOP_COUNT;

    this.result_text.text = label;
    this.result_text.style.fill = label_color;
    this.result_text.visible = true;
    this.result_elapsed_ms = 0;
  }

  // 최종 결과 — 손의 깃발은 치우고 승자 별명을 쓴 플랜카드를 든 채, 다음 게임/퇴장(Reset) 전까지 계속 깡충깡충 뛴다.
  // ribbon 은 플랜카드 위 리본 문구(무승부면 "DRAW" 처럼 바꿔 쓴다).
  public ShowFinalResult(winner_name: string, label: string, label_color: number, ribbon = "WINNER"): void {
    this.ShowRoundResult(null, label, label_color);
    this.left_flag.root.visible = false;
    this.right_flag.root.visible = false;
    this.lean_target = 0;
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

  // 결과 표시를 거두고 깃발을 내린다.
  // 깃발 없이 오리만 보여줄 때(로비) 쓴다. Reset() 이 불리면 다시 보인다.
  public HideFlags(): void {
    this.left_flag.root.visible = false;
    this.right_flag.root.visible = false;
  }

  public Reset(): void {
    this.hop_count = 0;
    this.SetFlag(this.left_flag, FLAG_LOWERED, false);
    this.SetFlag(this.right_flag, FLAG_LOWERED, false);
    this.lean_target = 0;
    this.result_text.visible = false;
    this.left_flag.root.visible = true;
    this.right_flag.root.visible = true;
    this.placard.visible = false;
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  private SetFlag(flag: Flag, angle: number, raised: boolean): void {
    flag.target = angle * flag.outward;
    flag.raised = raised;
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

    const ease = Math.min(1, delta_ms * FLAG_EASE);
    this.body.rotation += (this.lean_target - this.body.rotation) * ease;

    for (const flag of [this.left_flag, this.right_flag]) {
      // 들어 올린 깃발은 좌우로 흔들고 천을 펄럭인다.
      const wave = flag.raised ? Math.sin(this.elapsed_ms * 0.012) * 0.12 * flag.outward : 0;
      flag.root.rotation += (flag.target + wave - flag.root.rotation) * ease;
      flag.cloth.scale.x = flag.raised ? 0.88 + 0.12 * Math.abs(Math.sin(this.elapsed_ms * 0.018)) : 1;
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

  // 플랜카드: 크림색 천 + 빨간 테두리, 위쪽 "WINNER" 리본, 양옆 별, 가운데 승자 별명, 위 모서리를 쥔 두 손.
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

    // 플랜카드 위 모서리를 쥔 날개 끝.
    const hands = new Graphics();
    for (const x of [-HAND_X, HAND_X]) {
      hands.ellipse(x, -half_h + 2, 17, 13);
    }
    hands.fill(0xffffff).stroke({ color: 0xdcd8d2, width: 3 });

    this.placard.addChild(cloth, ribbon, ribbon_text, name_text, hands);
    return [name_text, ribbon_text];
  }

  // 깃대 + 깃발 천 + 꼭지. 기준점(0,0)이 손 위치라 rotation 으로 들고 내린다.
  private CreateFlag(color: number, outward: -1 | 1): Flag {
    const root = new Container();
    root.position.set(HAND_X * outward, HAND_Y);

    const pole = new Graphics()
      .roundRect(-4, -POLE_LENGTH, 8, POLE_LENGTH + 18, 4)
      .fill(0xb87a3d)
      .stroke({ color: 0x7a4a20, width: 2 });

    // 천은 깃대 꼭대기에서 바깥쪽으로 물결 모양으로 펼친다.
    const o = outward;
    const cloth = new Graphics()
      .moveTo(0, 0)
      .bezierCurveTo(o * 24, -10, o * 46, 12, o * 72, 2)
      .lineTo(o * 72, 50)
      .bezierCurveTo(o * 46, 60, o * 24, 38, 0, 48)
      .closePath()
      .fill(color)
      .stroke({ color: 0xffffff, width: 3, join: "round" });
    // 천 가운데 하트 무늬.
    cloth
      .circle(o * 31, 21, 6)
      .circle(o * 41, 21, 6)
      .fill(0xffffff)
      .moveTo(o * 25.5, 24)
      .lineTo(o * 46.5, 24)
      .lineTo(o * 36, 35)
      .closePath()
      .fill(0xffffff);
    cloth.position.set(0, -POLE_LENGTH + 4);

    const knob = new Graphics()
      .circle(0, -POLE_LENGTH - 4, 8)
      .fill(CUTE_COLOR.yellow)
      .stroke({ color: CUTE_COLOR.orange_dark, width: 2 });

    root.addChild(pole, cloth, knob);
    return { root, cloth, outward, target: 0, raised: false };
  }
}

// 목표값을 살짝 넘었다가 돌아오는 이징(0~1).
function EaseOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
