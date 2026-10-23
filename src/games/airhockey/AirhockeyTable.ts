// 에어하키 테이블 화면 — 직사각형 테이블, 퍽, 두 레버(내 것은 아래, 상대 것은 위)를 그리고 내 레버 드래그 입력을 받는다.
// 서버/네트워크는 모르고, 씬이 서버 좌표를 넣어 주면 그리기만 한다. 내 레버를 움직이면 onLeverMove 로 알린다.
//
// 좌표: 서버와 같은 논리 좌표(원점 = 테이블 정중앙, y 는 위쪽이 +, 단위 = 서버 테이블 720x1280 기준)를 쓰고,
// 화면에는 TABLE_SCALE 배로 줄여 그린다. 화면은 y 가 아래쪽이 + 라서 그릴 때 y 부호만 뒤집는다(ToScreenY).
import { Container, Graphics, Rectangle, Text, Ticker, type FederatedPointerEvent } from "pixi.js";
import { CUTE_COLOR, CUTE_FONT_FAMILY } from "../../ui/CuteTheme";
import {
  AIRHOCKEY_GOAL_WIDTH,
  AIRHOCKEY_LEVER_RADIUS,
  AIRHOCKEY_PUCK_RADIUS,
  AIRHOCKEY_TABLE_HEIGHT,
  AIRHOCKEY_TABLE_WIDTH,
  type AirhockeyPoint,
} from "./types";

// 화면에 그릴 테이블 안쪽(퍽이 다니는 곳) 높이(px) — 위아래 사용자 정보/버튼 자리를 빼고 남는 만큼.
export const TABLE_SCREEN_HEIGHT = 860;
export const TABLE_SCALE = TABLE_SCREEN_HEIGHT / AIRHOCKEY_TABLE_HEIGHT;
export const TABLE_SCREEN_WIDTH = AIRHOCKEY_TABLE_WIDTH * TABLE_SCALE;
// 테이블 테두리(벽) 두께(px). 벽은 테이블 안쪽 바깥에 그려서 충돌 영역(논리 크기)과 화면이 정확히 겹치게 한다.
export const WALL_THICKNESS = 16;

const HALF_WIDTH = AIRHOCKEY_TABLE_WIDTH / 2;
const HALF_HEIGHT = AIRHOCKEY_TABLE_HEIGHT / 2;
// 레버의 처음 자리 = 자기 골 라인에서 이만큼 앞(서버 AIRHOCKEY_BOT_HOME_OFFSET 과 같은 값).
const LEVER_HOME_OFFSET = 180;
// 한 판(ONE_START) 시작 때 레버 자리 = 퍽(가운데)에서 위/아래로 이만큼 떨어진 곳(중심 간 거리, 사용자 결정 2026-10-15).
// 퍽 반지름 30 + 레버 반지름 60 = 90 이라 가장자리 사이에는 210 이 빈다.
// 150(두 레버 간격 300) 은 너무 가까워 두 배(간격 600)로 늘렸다(사용자 결정 2026-10-15).
// ⚠️ 서버는 ONE_START 때 레버 자리를 정하지 않는다 — 대신 그 판의 첫 LEVER_MOVE 좌표에 레버를 바로 놓으므로(SnapLever),
//    클라이언트가 ONE_START 를 받자마자 이 자리를 첫 LEVER_MOVE 로 보내서 맞춘다.
const ROUND_START_OFFSET = 300;
// ONE_START 직후 서버가 이전 레버 위치를 한 번 다시 보낸다(ForceResendPositions). 그 값으로 상대 레버가 옛 자리로
// 튀었다 돌아오지 않게, 이 시간 동안은 시작 자리 근처(ROUND_START_TOLERANCE 안)로 온 상대 레버 위치만 받는다.
// 상대가 봇이면 시작 자리로 오지 않으므로 이 시간이 지나면 다시 그대로 받는다.
const ROUND_START_HOLD_MS = 500;
const ROUND_START_TOLERANCE = 10;
// 새 판에서 레버를 다시 잡을 때, 레버 반지름보다 이만큼 넓게 눌러도(가져가도) 잡힌 것으로 본다(논리 단위).
const GRAB_MARGIN = 30;
// 중앙 원 / 골대 앞 반원 반지름(논리 단위, 연출용).
const CENTER_CIRCLE_RADIUS = 110;
const GOAL_CREASE_RADIUS = 170;
// 서버 좌표는 초당 30번 오므로, 받은 좌표로 바로 순간이동하지 않고 이 시간 상수로 부드럽게 따라간다.
const SMOOTH_MS = 35;
// 이보다 멀리 떨어진 좌표가 오면(새 판 시작, 재접속 등) 따라가지 않고 바로 옮긴다.
const SNAP_DISTANCE = 400;
// 내 레버 위치를 서버로 보내는 최소 간격(ms) — 서버가 30Hz 로 중계하므로 그보다 자주 보낼 필요가 없다.
const SEND_INTERVAL_MS = 33;
// 골 문구가 떠 있는 시간.
const GOAL_TEXT_MS = 1600;
// 레버 무게(ms) — 서버 AIRHOCKEY_LEVER_WEIGHT_SEC(0.05초)와 반드시 같아야 한다(2026-10-22 사용자 요청 "레버가 너무 가볍다").
// 서버는 손가락 위치(LEVER_MOVE)를 "손"으로 보고, 레버가 그 손을 매 틱 (손 - 레버) × (1 - e^(-dt/τ)) 만큼 늦게 따라간다.
// 그래서 보내는 값은 손가락 위치 그대로 두고, 내 레버를 그릴 때만 같은 공식으로 늦춰야 화면 레버와 서버 판정 레버가 맞는다.
// 상대 레버(LEVER_MOVE 중계)는 이미 무게가 적용된 서버 좌표라 다시 늦추지 않는다.
const LEVER_WEIGHT_MS = 50;
// 손과 이보다 가까우면 손 자리에 딱 맞춰 멈춘다(서버 AIRHOCKEY_LEVER_SETTLE_DISTANCE).
const LEVER_SETTLE_DISTANCE = 0.5;

export interface AirhockeyTableOptions {
  // 내 레버를 움직였을 때(서버로 보낼 내 기준 좌표, 정수).
  onLeverMove: (loc: AirhockeyPoint) => void;
}

interface SmoothPoint {
  x: number;
  y: number;
  target_x: number;
  target_y: number;
}

export class AirhockeyTable extends Container {
  private readonly options: AirhockeyTableOptions;
  // 테이블 중심이 원점이고 TABLE_SCALE 로 줄인 논리 좌표 공간. 퍽/레버는 여기에 올린다.
  private readonly field = new Container();
  private readonly puck: Container;
  private readonly my_lever: Container;
  private readonly opponent_lever: Container;
  private readonly message_text: Text;
  private readonly goal_text: Text;

  private readonly puck_pos: SmoothPoint = { x: 0, y: 0, target_x: 0, target_y: 0 };
  private readonly opponent_pos: SmoothPoint = { x: 0, y: HALF_HEIGHT - LEVER_HOME_OFFSET, target_x: 0, target_y: HALF_HEIGHT - LEVER_HOME_OFFSET };
  // 내 레버는 손가락 위치를 바로 따라간다(서버 왕복을 기다리면 조작감이 나빠진다).
  // my_hand = 손가락 위치(서버로 보내는 값), my_pos = 화면에 그리는 레버(my_hand 를 LEVER_WEIGHT_MS 만큼 늦게 따라간다).
  private my_hand: AirhockeyPoint = { x: 0, y: -HALF_HEIGHT + LEVER_HOME_OFFSET };
  private my_pos: AirhockeyPoint = { x: 0, y: -HALF_HEIGHT + LEVER_HOME_OFFSET };

  private playable = false;
  private dragging = false;
  // 새 판 시작으로 레버를 시작 자리에 옮긴 뒤, 아직 다시 잡지 않았는지 — 이때는 마우스/손가락이 레버 위에 와야
  // 움직이기 시작한다(안 그러면 마우스를 따라 시작 자리에서 바로 튀어 나가 버린다).
  private needs_grab = false;
  // 이 시각(performance.now)까지는 시작 자리 근처가 아닌 상대 레버 위치를 무시한다(ROUND_START_HOLD_MS 참고).
  private opponent_hold_until = 0;
  // 서버로 아직 안 보낸 내 레버 위치가 있는지, 마지막으로 보낸 위치/시각.
  private send_pending = false;
  private last_sent: AirhockeyPoint | null = null;
  private last_sent_at = 0;
  private goal_text_left_ms = 0;

  constructor(options: AirhockeyTableOptions) {
    super();
    this.options = options;

    this.addChild(CreateTableGraphics());

    this.field.scale.set(TABLE_SCALE);
    this.field.position.set(TABLE_SCREEN_WIDTH / 2, TABLE_SCREEN_HEIGHT / 2);
    this.opponent_lever = CreateLever(CUTE_COLOR.shirt_dark, 0xbfe2ff);
    this.my_lever = CreateLever(CUTE_COLOR.orange, 0xffe0a8);
    this.puck = CreatePuck();
    // 퍽은 테이블 바닥에 붙어 미끄러지고 레버는 그 위를 누르는 손잡이라, 퍽을 레버보다 아래에 그린다.
    this.field.addChild(this.puck, this.opponent_lever, this.my_lever);
    this.addChild(this.field);

    this.message_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.brown,
        fontSize: 26,
        fontFamily: CUTE_FONT_FAMILY,
        align: "center",
        wordWrap: true,
        wordWrapWidth: TABLE_SCREEN_WIDTH - 40,
        stroke: { color: 0xffffff, width: 6, join: "round" },
      },
    });
    this.message_text.anchor.set(0.5);
    // 가운데 원 바로 위(상대 쪽)에 둬서 퍽/레버를 가리지 않게 한다.
    this.message_text.position.set(TABLE_SCREEN_WIDTH / 2, TABLE_SCREEN_HEIGHT / 2 - 150);

    this.goal_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 72,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 12, join: "round" },
        dropShadow: { color: CUTE_COLOR.orange_dark, alpha: 0.5, distance: 5, angle: Math.PI / 2, blur: 0 },
      },
    });
    this.goal_text.anchor.set(0.5);
    this.goal_text.position.set(TABLE_SCREEN_WIDTH / 2, TABLE_SCREEN_HEIGHT / 2);
    this.goal_text.visible = false;
    this.addChild(this.message_text, this.goal_text);

    // 테이블 전체(벽 포함)를 누르고 끌면 내 레버가 따라온다. 손가락이 테이블 밖으로 나가도 계속 따라가게
    // 이동은 globalpointermove 로 받는다.
    this.eventMode = "static";
    this.hitArea = new Rectangle(-WALL_THICKNESS, -WALL_THICKNESS, TABLE_SCREEN_WIDTH + WALL_THICKNESS * 2, TABLE_SCREEN_HEIGHT + WALL_THICKNESS * 2);
    this.on("pointerdown", this.OnPointerDown);
    this.on("globalpointermove", this.OnPointerMove);
    this.on("pointerup", this.OnPointerUp);
    this.on("pointerupoutside", this.OnPointerUp);

    this.ResetPositions();
    Ticker.shared.add(this.OnTick);
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  // 내 레버 조작 가능 여부. 꺼지면 누르고 있던 것도 놓는다.
  public SetPlayable(playable: boolean): void {
    this.playable = playable;
    if (!playable) this.dragging = false;
    this.cursor = playable ? "pointer" : "default";
  }

  // 퍽은 가운데, 레버는 각자 골대 앞으로 되돌린다(새 게임 시작/재시작).
  public ResetPositions(): void {
    this.SnapPuck({ x: 0, y: 0 });
    this.SetOpponentLever({ x: 0, y: HALF_HEIGHT - LEVER_HOME_OFFSET }, true);
    this.SetMyLever({ x: 0, y: -HALF_HEIGHT + LEVER_HOME_OFFSET });
    this.needs_grab = false;
    this.opponent_hold_until = 0;
    this.goal_text_left_ms = 0;
    this.goal_text.visible = false;
  }

  // 한 판 시작(ONE_START) — 퍽은 가운데, 두 레버는 퍽 위/아래 ROUND_START_OFFSET 자리에 놓는다.
  // 내 레버 자리는 서버에도 보낸다(상대 클라이언트도 같은 일을 하므로 상대 레버는 곧 서버가 중계해 준 위치로 맞춰진다).
  public PlaceForRoundStart(): void {
    this.SnapPuck({ x: 0, y: 0 });
    this.SetOpponentLever({ x: 0, y: ROUND_START_OFFSET }, true);
    this.opponent_hold_until = performance.now() + ROUND_START_HOLD_MS;
    this.SetMyLever({ x: 0, y: -ROUND_START_OFFSET });
    // 다음 프레임을 기다리지 않고 바로 보낸다 — 서버가 이 판의 첫 LEVER_MOVE 를 시작 자리로 삼기 때문.
    this.last_sent = null;
    this.last_sent_at = 0;
    this.FlushLeverMove();
    this.dragging = false;
    this.needs_grab = true;
  }

  // 서버가 보낸 퍽 위치 — 부드럽게 따라가고, 너무 멀면 바로 옮긴다.
  public SetPuck(loc: AirhockeyPoint): void {
    SetSmoothTarget(this.puck_pos, loc, false);
  }

  // 퍽을 보간 없이 바로 옮긴다(새 판 시작 — 골대 안에서 가운데로 미끄러지는 연출을 막는다).
  public SnapPuck(loc: AirhockeyPoint): void {
    SetSmoothTarget(this.puck_pos, loc, true);
    this.ApplyPositions();
  }

  public SetOpponentLever(loc: AirhockeyPoint, snap = false): void {
    if (!snap && performance.now() < this.opponent_hold_until) {
      const is_at_start = Math.hypot(loc.x, loc.y - ROUND_START_OFFSET) <= ROUND_START_TOLERANCE;
      if (!is_at_start) return;
      this.opponent_hold_until = 0;
    }
    SetSmoothTarget(this.opponent_pos, loc, snap);
    if (snap) this.ApplyPositions();
  }

  // 내 레버 위치를 정한다(재접속 복원 등). 서버에도 이 위치를 알린다.
  // 무게 없이 바로 놓는다 — 판의 첫 LEVER_MOVE 를 서버도 그 자리에 바로 놓는다(SnapLever).
  public SetMyLever(loc: AirhockeyPoint): void {
    this.my_hand = ClampMyLever(loc);
    this.my_pos = { ...this.my_hand };
    this.send_pending = true;
    this.ApplyPositions();
  }

  // 테이블 가운데 위쪽 안내 문구(빈 문자열이면 숨김).
  public SetMessage(message: string): void {
    this.message_text.text = message;
  }

  // 골 문구를 크게 띄웠다가 GOAL_TEXT_MS 뒤에 지운다.
  public ShowGoalText(text: string, color: number): void {
    this.goal_text.text = text;
    this.goal_text.style.fill = color;
    this.goal_text.visible = true;
    this.goal_text_left_ms = GOAL_TEXT_MS;
  }

  public HideGoalText(): void {
    this.goal_text_left_ms = 0;
    this.goal_text.visible = false;
  }

  // --- 입력 ---

  private readonly OnPointerDown = (event: FederatedPointerEvent): void => {
    if (!this.playable) return;
    if (!this.TryGrab(event)) return;
    this.dragging = true;
    this.MoveMyLeverTo(event);
  };

  private readonly OnPointerMove = (event: FederatedPointerEvent): void => {
    if (!this.playable) return;
    // 마우스는 누르지 않아도 테이블 위에서 움직이면 따라가게 한다(웹에서 마우스로 하기 편하게). 터치는 누른 채 끌 때만.
    const is_mouse_over = event.pointerType === "mouse" && this.IsOverTable(event);
    if (!this.dragging && !is_mouse_over) return;
    if (!this.TryGrab(event)) return;
    this.MoveMyLeverTo(event);
  };

  // 새 판 시작 직후라면 포인터가 내 레버 위에 왔을 때만 잡힌다. 잡히면(또는 잡을 필요가 없으면) true.
  private TryGrab(event: FederatedPointerEvent): boolean {
    if (!this.needs_grab) return true;
    const local = this.field.toLocal(event.global);
    const dist = Math.hypot(local.x - this.my_pos.x, -local.y - this.my_pos.y);
    if (dist > AIRHOCKEY_LEVER_RADIUS + GRAB_MARGIN) return false;
    this.needs_grab = false;
    return true;
  }

  private readonly OnPointerUp = (): void => {
    this.dragging = false;
  };

  private IsOverTable(event: FederatedPointerEvent): boolean {
    const local = this.toLocal(event.global);
    return this.hitArea !== null && (this.hitArea as Rectangle).contains(local.x, local.y);
  }

  private MoveMyLeverTo(event: FederatedPointerEvent): void {
    const local = this.field.toLocal(event.global);
    this.my_hand = ClampMyLever({ x: local.x, y: -local.y });
    this.send_pending = true;
  }

  // --- 매 프레임 ---

  private readonly OnTick = (ticker: Ticker): void => {
    const delta_ms = ticker.deltaMS;
    const ease = 1 - Math.exp(-delta_ms / SMOOTH_MS);
    for (const point of [this.puck_pos, this.opponent_pos]) {
      point.x += (point.target_x - point.x) * ease;
      point.y += (point.target_y - point.y) * ease;
    }
    this.FollowMyHand(delta_ms);
    this.ApplyPositions();
    this.FlushLeverMove();

    if (this.goal_text_left_ms > 0) {
      this.goal_text_left_ms -= delta_ms;
      // 처음엔 크게 튀어나왔다가 제자리로 줄어든다.
      const elapsed = GOAL_TEXT_MS - this.goal_text_left_ms;
      const pop = elapsed < 200 ? 0.6 + (elapsed / 200) * 0.6 : Math.max(1, 1.2 - ((elapsed - 200) / 200) * 0.2);
      this.goal_text.scale.set(pop);
      if (this.goal_text_left_ms <= 0) this.goal_text.visible = false;
    }
  };

  // 그리는 내 레버가 손가락을 무게만큼 늦게 따라간다 — 서버 ComputeLeverMove / GetLeverFollowRatio 와 같은 공식.
  private FollowMyHand(delta_ms: number): void {
    const gap_x = this.my_hand.x - this.my_pos.x;
    const gap_y = this.my_hand.y - this.my_pos.y;
    if (Math.hypot(gap_x, gap_y) <= LEVER_SETTLE_DISTANCE) {
      this.my_pos = { ...this.my_hand };
      return;
    }
    const follow = 1 - Math.exp(-delta_ms / LEVER_WEIGHT_MS);
    this.my_pos = { x: this.my_pos.x + gap_x * follow, y: this.my_pos.y + gap_y * follow };
  }

  // 바뀐 손가락 위치를 SEND_INTERVAL_MS 마다 한 번씩만 보낸다(같은 좌표는 다시 보내지 않는다).
  // 무게는 서버가 적용하므로 늦춘 레버(my_pos)가 아니라 손가락 위치(my_hand)를 보낸다.
  private FlushLeverMove(): void {
    if (!this.send_pending) return;
    const now = performance.now();
    if (now - this.last_sent_at < SEND_INTERVAL_MS) return;
    this.send_pending = false;
    const loc = { x: Math.round(this.my_hand.x), y: Math.round(this.my_hand.y) };
    if (this.last_sent && this.last_sent.x === loc.x && this.last_sent.y === loc.y) return;
    this.last_sent = loc;
    this.last_sent_at = now;
    this.options.onLeverMove(loc);
  }

  private ApplyPositions(): void {
    // 내 레버는 손가락 위치에 바로 그리고 퍽은 서버 좌표를 조금 늦게 따라가므로, 칠 때 화면에서 둘이 겹쳐 보인다.
    // 서버에서는 겹칠 수 없으니(서버가 퍽을 레버 바깥으로 밀어낸다) 그릴 때만 퍽을 레버에 맞닿는 자리까지 밀어 둔다.
    const puck = PushOutOfLevers({ x: this.puck_pos.x, y: this.puck_pos.y }, [this.my_pos, this.opponent_pos]);
    this.puck.position.set(puck.x, ToScreenY(puck.y));
    this.opponent_lever.position.set(this.opponent_pos.x, ToScreenY(this.opponent_pos.y));
    this.my_lever.position.set(this.my_pos.x, ToScreenY(this.my_pos.y));
  }
}

// 논리 y(위쪽 +) → field 안 화면 y(아래쪽 +).
function ToScreenY(y: number): number {
  return -y;
}

function SetSmoothTarget(point: SmoothPoint, loc: AirhockeyPoint, snap: boolean): void {
  point.target_x = loc.x;
  point.target_y = loc.y;
  if (snap || Math.hypot(loc.x - point.x, loc.y - point.y) > SNAP_DISTANCE) {
    point.x = loc.x;
    point.y = loc.y;
  }
}

// 퍽이 레버와 겹치면 레버 중심에서 바깥쪽으로 맞닿는 거리까지 밀어낸 위치(그리기 전용 — 서버 좌표는 바꾸지 않는다).
function PushOutOfLevers(puck: AirhockeyPoint, levers: AirhockeyPoint[]): AirhockeyPoint {
  const min_dist = AIRHOCKEY_PUCK_RADIUS + AIRHOCKEY_LEVER_RADIUS;
  let result = puck;
  for (const lever of levers) {
    const dx = result.x - lever.x;
    const dy = result.y - lever.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= min_dist || dist === 0) continue;
    result = { x: lever.x + (dx / dist) * min_dist, y: lever.y + (dy / dist) * min_dist };
  }
  return result;
}

// 내 레버가 갈 수 있는 영역 — 테이블 안 + 내 쪽 절반(중앙선을 넘지 못한다). 서버 ClampLeverPosition(side 0) 과 같다.
function ClampMyLever(point: AirhockeyPoint): AirhockeyPoint {
  return {
    x: Math.min(HALF_WIDTH - AIRHOCKEY_LEVER_RADIUS, Math.max(-HALF_WIDTH + AIRHOCKEY_LEVER_RADIUS, point.x)),
    y: Math.min(-AIRHOCKEY_LEVER_RADIUS, Math.max(-HALF_HEIGHT + AIRHOCKEY_LEVER_RADIUS, point.y)),
  };
}

// 테이블 판 + 벽 + 골대 + 중앙선 (화면 px 단위, 테이블 안쪽 왼쪽 위가 (0,0)).
function CreateTableGraphics(): Graphics {
  const width = TABLE_SCREEN_WIDTH;
  const height = TABLE_SCREEN_HEIGHT;
  const goal_half = (AIRHOCKEY_GOAL_WIDTH * TABLE_SCALE) / 2;
  const center_x = width / 2;
  const center_y = height / 2;
  const wall = WALL_THICKNESS;
  const graphics = new Graphics();

  // 그림자 + 벽(하늘색 테두리) + 판(크림색).
  graphics
    .roundRect(-wall, -wall + 8, width + wall * 2, height + wall * 2, 30)
    .fill({ color: 0x000000, alpha: 0.12 })
    .roundRect(-wall, -wall, width + wall * 2, height + wall * 2, 30)
    .fill(CUTE_COLOR.shirt)
    .roundRect(0, 0, width, height, 16)
    .fill(CUTE_COLOR.cream);

  // 공기 구멍 무늬 — 에어하키 판 느낌을 내는 옅은 점.
  for (let y = 24; y < height; y += 34) {
    for (let x = 24 + ((y / 34) % 2) * 17; x < width; x += 34) {
      graphics.circle(x, y, 2.2);
    }
  }
  graphics.fill({ color: CUTE_COLOR.shirt, alpha: 0.28 });

  // 중앙선 + 중앙 원.
  graphics
    .rect(0, center_y - 3, width, 6)
    .fill({ color: CUTE_COLOR.pink, alpha: 0.7 })
    .circle(center_x, center_y, CENTER_CIRCLE_RADIUS * TABLE_SCALE)
    .stroke({ color: CUTE_COLOR.pink, width: 5, alpha: 0.7 })
    .circle(center_x, center_y, 8)
    .fill({ color: CUTE_COLOR.pink, alpha: 0.9 });

  // 골대 앞 반원 — 위(상대)는 파랑, 아래(나)는 주황.
  const crease = GOAL_CREASE_RADIUS * TABLE_SCALE;
  graphics
    .arc(center_x, 0, crease, 0, Math.PI)
    .stroke({ color: CUTE_COLOR.shirt_dark, width: 5, alpha: 0.55 })
    .arc(center_x, height, crease, Math.PI, Math.PI * 2)
    .stroke({ color: CUTE_COLOR.orange, width: 5, alpha: 0.65 });

  // 골대 입구 — 벽을 뚫고 안쪽이 들여다보이는 구멍(진한 갈색)으로 그린다.
  graphics
    .roundRect(center_x - goal_half, -wall - 6, goal_half * 2, wall + 8, 8)
    .fill(CUTE_COLOR.brown)
    .roundRect(center_x - goal_half, height - 2, goal_half * 2, wall + 8, 8)
    .fill(CUTE_COLOR.brown);
  // 골대 기둥(양옆 동그란 마개).
  for (const y of [-wall / 2, height + wall / 2]) {
    for (const x of [center_x - goal_half, center_x + goal_half]) {
      graphics.circle(x, y, wall * 0.7).fill(0xffffff).stroke({ color: CUTE_COLOR.shirt_dark, width: 3 });
    }
  }
  return graphics;
}

// 레버(말렛) — 바깥 테두리 + 안쪽 고리 + 가운데 손잡이. 논리 반지름 그대로 그린다(field 가 줄여 준다).
function CreateLever(color: number, light: number): Container {
  const radius = AIRHOCKEY_LEVER_RADIUS;
  const graphics = new Graphics()
    .circle(0, 8, radius)
    .fill({ color: 0x000000, alpha: 0.15 })
    .circle(0, 0, radius)
    .fill(color)
    .stroke({ color: 0xffffff, width: 6 })
    .circle(0, 0, radius * 0.68)
    .fill(light)
    .circle(0, -4, radius * 0.4)
    .fill(color)
    .stroke({ color: 0xffffff, width: 5 })
    .ellipse(-radius * 0.14, -radius * 0.2, radius * 0.16, radius * 0.1)
    .fill({ color: 0xffffff, alpha: 0.7 });
  const lever = new Container();
  lever.addChild(graphics);
  return lever;
}

// 퍽 — 빨간 원판에 흰 고리와 하이라이트.
function CreatePuck(): Container {
  const radius = AIRHOCKEY_PUCK_RADIUS;
  const graphics = new Graphics()
    .circle(0, 5, radius)
    .fill({ color: 0x000000, alpha: 0.18 })
    .circle(0, 0, radius)
    .fill(CUTE_COLOR.red)
    .stroke({ color: 0xffffff, width: 5 })
    .circle(0, 0, radius * 0.55)
    .stroke({ color: 0xffffff, width: 3, alpha: 0.8 })
    .ellipse(-radius * 0.3, -radius * 0.35, radius * 0.28, radius * 0.16)
    .fill({ color: 0xffffff, alpha: 0.7 });
  const puck = new Container();
  puck.addChild(graphics);
  return puck;
}
