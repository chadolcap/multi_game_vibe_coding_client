// 에어하키 첫 서브를 정하는 동전 던지기 연출 — 씬이 SERVE_SELECT 를 받으면 Play() 를 부르고, GAME_START 때 Hide() 한다.
// 동전이 위로 튀어 오르며 두 별명 면을 번갈아 보여주다가, 내려앉으면 서버가 정한 서브 유저의 별명 면으로 멈춘다.
// 서버/네트워크는 모른다 — 어느 별명이 이기는지는 씬이 정해서 넘긴다. 결과는 연출일 뿐 진행 판단에 쓰지 않는다.
import { Container, Graphics, Text, Ticker } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT } from "../../config";
import { CUTE_COLOR, CUTE_FONT_FAMILY } from "../../ui/CuteTheme";

const COIN_RADIUS = 110;
// 동전이 떠 있는 시간(ms). 서버는 SERVE_SELECT 5초 뒤 GAME_START 를 보내므로 남은 시간 동안 결과를 보여준다.
const FLIP_MS = 2000;
// 떠 있는 동안 도는 반 바퀴 수 — 홀수라서 처음 보이는 면(0)의 반대 면(1 = 결과)으로 멈춘다.
const FLIP_HALF_TURNS = 11;
// 가장 높이 올라가는 높이(px).
const FLIP_HEIGHT = 260;
// 착지 후 결과 면이 톡 튀어나오는 시간(ms).
const LAND_POP_MS = 300;
// 동전 안 별명 글자 폭 한도 — 넘으면 글자를 줄인다.
const NAME_MAX_WIDTH = COIN_RADIUS * 1.6;

export interface AirhockeyCoinFace {
  name: string;
  // 동전 테두리 색 — 나/상대 구분(점수판과 같은 색).
  color: number;
}

export class AirhockeyCoinToss extends Container {
  private readonly title_text: Text;
  private readonly result_text: Text;
  private readonly coin = new Container();
  // [0] = 처음 보이는 면, [1] = 결과 면.
  private readonly faces: [Container, Container];
  private readonly face_texts: [Text, Text];
  private readonly face_rings: [Graphics, Graphics];
  private center_x = GAME_WIDTH / 2;
  private center_y = GAME_HEIGHT / 2;
  private result_name = "";
  private elapsed_ms = 0;
  private playing = false;

  constructor() {
    super();
    this.visible = false;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.35 });

    this.title_text = new Text({
      text: "동전 던지기!",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 44,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 9, join: "round" },
      },
    });
    this.title_text.anchor.set(0.5);

    this.result_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.red,
        fontSize: 34,
        fontFamily: CUTE_FONT_FAMILY,
        align: "center",
        wordWrap: true,
        wordWrapWidth: GAME_WIDTH - 80,
        stroke: { color: 0xffffff, width: 8, join: "round" },
      },
    });
    this.result_text.anchor.set(0.5, 0);

    const front = CreateCoinFace();
    const back = CreateCoinFace();
    this.faces = [front.face, back.face];
    this.face_texts = [front.text, back.text];
    this.face_rings = [front.ring, back.ring];
    this.coin.addChild(front.face, back.face);

    this.addChild(dim, this.title_text, this.coin, this.result_text);
    this.Layout();
    Ticker.shared.add(this.OnTick);
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  // 동전이 내려앉을 자리(화면 좌표). 씬이 테이블 가운데로 맞춘다.
  public SetCenter(x: number, y: number): void {
    this.center_x = x;
    this.center_y = y;
    this.Layout();
  }

  // other = 처음 보이는 면, result = 서브할 유저(멈출 면).
  public Play(other: AirhockeyCoinFace, result: AirhockeyCoinFace): void {
    for (const [index, face] of [other, result].entries()) {
      SetFace(this.face_texts[index], this.face_rings[index], face);
    }
    this.result_name = result.name;
    this.result_text.text = "";
    this.elapsed_ms = 0;
    this.playing = true;
    this.visible = true;
    this.ApplyFlip(0);
  }

  public Hide(): void {
    this.playing = false;
    this.visible = false;
  }

  private Layout(): void {
    this.title_text.position.set(this.center_x, this.center_y - COIN_RADIUS - FLIP_HEIGHT - 70);
    this.result_text.position.set(this.center_x, this.center_y + COIN_RADIUS + 30);
    this.coin.position.set(this.center_x, this.center_y);
  }

  private readonly OnTick = (ticker: Ticker): void => {
    if (!this.playing) return;
    this.elapsed_ms += ticker.deltaMS;
    if (this.elapsed_ms < FLIP_MS) {
      this.ApplyFlip(this.elapsed_ms / FLIP_MS);
      return;
    }
    // 착지 — 결과 면으로 멈춰 크게 튀어나왔다가 제자리로 줄어든다.
    if (this.result_text.text === "") {
      this.ApplyFlip(1);
      this.result_text.text = `${this.result_name}님이 먼저 서브해요!`;
    }
    const land_ms = this.elapsed_ms - FLIP_MS;
    const pop = land_ms < LAND_POP_MS ? 1 + 0.15 * Math.sin((land_ms / LAND_POP_MS) * Math.PI) : 1;
    this.coin.scale.set(pop);
    if (land_ms >= LAND_POP_MS) this.playing = false;
  };

  // progress 0~1 — 포물선으로 떴다가 내려오고, 회전은 갈수록 느려진다(ease-out).
  // 세로로 뒤집히는 동전이라 scale.y 를 cos 로 줄였다 늘리고, 반 바퀴마다 보이는 면을 바꾼다.
  private ApplyFlip(progress: number): void {
    const height = 4 * FLIP_HEIGHT * progress * (1 - progress);
    const eased = 1 - (1 - progress) ** 3;
    const angle = eased * FLIP_HALF_TURNS * Math.PI;
    const face_index = Math.floor(angle / Math.PI + 0.5) % 2;
    this.coin.position.set(this.center_x, this.center_y - height);
    this.coin.scale.set(1, Math.max(0.04, Math.abs(Math.cos(angle))));
    this.faces[0].visible = face_index === 0;
    this.faces[1].visible = face_index === 1;
  }
}

// 동전 한 면 — 금색 원판 + 나/상대 색 테두리 + 가운데 별명. 테두리 색과 별명은 Play() 때 바꾼다.
function CreateCoinFace(): { face: Container; ring: Graphics; text: Text } {
  const face = new Container();
  const body = new Graphics()
    .circle(0, 8, COIN_RADIUS)
    .fill({ color: 0x000000, alpha: 0.18 })
    .circle(0, 0, COIN_RADIUS)
    .fill(CUTE_COLOR.yellow)
    .circle(0, 0, COIN_RADIUS * 0.82)
    .stroke({ color: 0xffffff, width: 4, alpha: 0.8 })
    .ellipse(-COIN_RADIUS * 0.35, -COIN_RADIUS * 0.45, COIN_RADIUS * 0.3, COIN_RADIUS * 0.14)
    .fill({ color: 0xffffff, alpha: 0.55 });
  const ring = new Graphics();
  const text = new Text({
    text: "",
    style: { fill: CUTE_COLOR.brown, fontSize: 40, fontFamily: CUTE_FONT_FAMILY, stroke: { color: 0xffffff, width: 6, join: "round" } },
  });
  text.anchor.set(0.5);
  face.addChild(body, ring, text);
  return { face, ring, text };
}

function SetFace(text: Text, ring: Graphics, face: AirhockeyCoinFace): void {
  ring.clear().circle(0, 0, COIN_RADIUS).stroke({ color: face.color, width: 10 });
  text.text = face.name;
  text.style.fill = face.color;
  text.scale.set(1);
  if (text.width > NAME_MAX_WIDTH) text.scale.set(NAME_MAX_WIDTH / text.width);
}
