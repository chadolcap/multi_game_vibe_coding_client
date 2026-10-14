// 오델로 8x8 보드 — 돌 그리기, 놓을 수 있는 자리 표시, 자리 클릭 처리만 담당한다.
// 규칙(합법수/뒤집기) 판정은 서버가 한다: TURN_START 의 can 으로 놓을 자리를 받고, SELECT_GAME 결과의
// change 로 뒤집을 돌을 받으므로 이 컴포넌트는 받은 좌표를 그대로 그리기만 한다. 서버/네트워크는 모른다.
// 돌은 칸마다 OthelloStone 으로 두어, 놓을 때는 위에서 톡 떨어지고 뒤집힐 때는 들려서 3D 처럼 뒤집히게 한다.
import { Container, Graphics, Rectangle, Ticker } from "pixi.js";
import { OthelloColor, type OthelloPoint } from "./types";
import { CUTE_COLOR } from "../../ui/CuteTheme";

const BOARD_SIZE = 8;
const CELL_SIZE = 80;
export const OTHELLO_BOARD_PIXEL_SIZE = BOARD_SIZE * CELL_SIZE;
// 말판 둘레 나무 틀 두께(말판 바깥으로 그린다).
const FRAME_SIZE = 14;

const COLOR_CELL_LIGHT = 0x9edc9a;
const COLOR_CELL_DARK = 0x8ed28b;
const COLOR_LINE = 0x5fae68;
const COLOR_FRAME = 0xffd9a0;
const COLOR_HINT = 0xffe066;

const STONE_RADIUS = CELL_SIZE / 2 - 9;
// 뒤집기 한 번에 걸리는 시간과, 놓은 자리에서 한 칸 멀어질 때마다 늦게 뒤집히는 시간(물결처럼 차례로 뒤집힌다).
const FLIP_MS = 460;
const FLIP_STAGGER_MS = 80;
// 뒤집히는 동안 돌이 들리는 높이.
const FLIP_LIFT_PX = 16;
const DROP_MS = 300;
const DROP_HEIGHT_PX = 46;

type Cell = OthelloColor | null;

export interface OthelloBoardOptions {
  // 놓을 수 있는 자리로 표시된 칸을 눌렀을 때 호출된다.
  onSelect: (point: OthelloPoint) => void;
}

export class OthelloBoard extends Container {
  private cells: Cell[][] = [];
  private hints: OthelloPoint[] = [];
  private last_move: OthelloPoint | null = null;
  private readonly stones = new Map<number, OthelloStone>();
  private readonly stone_layer = new Container();
  private readonly hint_layer = new Graphics();
  private readonly marker = new Graphics();
  private elapsed_ms = 0;

  constructor(options: OthelloBoardOptions) {
    super();

    const frame = new Graphics()
      .roundRect(-FRAME_SIZE, -FRAME_SIZE + 8, OTHELLO_BOARD_PIXEL_SIZE + FRAME_SIZE * 2, OTHELLO_BOARD_PIXEL_SIZE + FRAME_SIZE * 2, 28)
      .fill({ color: 0x000000, alpha: 0.12 })
      .roundRect(-FRAME_SIZE, -FRAME_SIZE, OTHELLO_BOARD_PIXEL_SIZE + FRAME_SIZE * 2, OTHELLO_BOARD_PIXEL_SIZE + FRAME_SIZE * 2, 28)
      .fill(COLOR_FRAME)
      .stroke({ color: CUTE_COLOR.orange_dark, width: 4 });

    // 체크무늬 칸 + 격자선 + 네 군데 화점.
    const background = new Graphics();
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        background.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE).fill((x + y) % 2 === 0 ? COLOR_CELL_LIGHT : COLOR_CELL_DARK);
      }
    }
    for (let i = 1; i < BOARD_SIZE; i++) {
      const offset = i * CELL_SIZE;
      background.moveTo(offset, 0).lineTo(offset, OTHELLO_BOARD_PIXEL_SIZE);
      background.moveTo(0, offset).lineTo(OTHELLO_BOARD_PIXEL_SIZE, offset);
    }
    background.stroke({ width: 2, color: COLOR_LINE });
    for (const [x, y] of [[2, 2], [6, 2], [2, 6], [6, 6]]) {
      background.circle(x * CELL_SIZE, y * CELL_SIZE, 5);
    }
    background.fill(COLOR_LINE);

    this.addChild(frame, background, this.hint_layer, this.stone_layer, this.marker);

    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, OTHELLO_BOARD_PIXEL_SIZE, OTHELLO_BOARD_PIXEL_SIZE);
    this.on("pointertap", (event) => {
      if (this.hints.length === 0) return;
      const local = this.toLocal(event.global);
      const x = Math.floor(local.x / CELL_SIZE);
      const y = Math.floor(local.y / CELL_SIZE);
      if (this.hints.some((hint) => hint.x === x && hint.y === y)) {
        options.onSelect({ x, y });
      }
    });

    this.Reset();
    Ticker.shared.add(this.OnTick);
  }

  // 새 판 시작 배치 — 서버의 CreateInitialBoard 와 같다(중앙 4칸: (3,3)·(4,4)=흰색, (4,3)·(3,4)=검정).
  public Reset(): void {
    this.cells = Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null));
    this.cells[3][3] = OthelloColor.WHITE;
    this.cells[4][4] = OthelloColor.WHITE;
    this.cells[3][4] = OthelloColor.BLACK;
    this.cells[4][3] = OthelloColor.BLACK;
    this.hints = [];
    this.last_move = null;
    this.SyncStonesWithoutAnimation();
    this.RedrawHints();
  }

  // GAME_STATUS(재접속 상태 복원) — 보드를 비우고 흰색/검정 돌 좌표 목록으로 통째로 다시 채운다.
  // 놓을 수 있는 자리 표시(hints)는 건드리지 않는다(TURN_START 가 GAME_STATUS 보다 먼저 올 수 있다).
  public SetStones(white_points: OthelloPoint[], black_points: OthelloPoint[]): void {
    this.cells = Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null));
    for (const point of white_points) this.cells[point.y][point.x] = OthelloColor.WHITE;
    for (const point of black_points) this.cells[point.y][point.x] = OthelloColor.BLACK;
    this.last_move = null;
    this.SyncStonesWithoutAnimation();
  }

  // 새 돌은 위에서 톡 떨어지듯 놓인다.
  public PlaceStone(point: OthelloPoint, color: OthelloColor): void {
    this.cells[point.y][point.x] = color;
    this.last_move = point;
    const stone = this.GetOrCreateStone(point);
    stone.SetColor(color);
    stone.PlayDrop();
    this.RedrawMarker();
  }

  // SELECT_GAME 결과의 change — 뒤집히는 상대 돌의 좌표를 모두 color 로 바꾼다.
  // 방금 놓은 자리(last_move)에서 가까운 돌부터 차례로 3D 처럼 뒤집힌다.
  public FlipStones(points: OthelloPoint[], color: OthelloColor): void {
    for (const point of points) {
      this.cells[point.y][point.x] = color;
      const distance = this.last_move ? Math.max(Math.abs(point.x - this.last_move.x), Math.abs(point.y - this.last_move.y)) : 1;
      // 놓는 연출(DROP_MS)이 끝날 즈음부터 뒤집기 시작한다.
      this.GetOrCreateStone(point).FlipTo(color, DROP_MS * 0.6 + (distance - 1) * FLIP_STAGGER_MS);
    }
  }

  // 놓을 수 있는 자리를 표시하고, 그 칸만 클릭에 반응하게 한다. 빈 배열이면 표시와 클릭을 모두 끈다.
  public SetHints(points: OthelloPoint[]): void {
    this.hints = points;
    this.RedrawHints();
  }

  public CountStones(): { black: number; white: number } {
    let black = 0;
    let white = 0;
    for (const row of this.cells) {
      for (const cell of row) {
        if (cell === OthelloColor.BLACK) black++;
        else if (cell === OthelloColor.WHITE) white++;
      }
    }
    return { black, white };
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  private readonly OnTick = (ticker: Ticker): void => {
    this.elapsed_ms += ticker.deltaMS;
    for (const stone of this.stones.values()) stone.Update(ticker.deltaMS);
    // 놓을 수 있는 자리 표시는 은은하게 깜빡인다.
    this.hint_layer.alpha = 0.65 + 0.35 * Math.sin(this.elapsed_ms * 0.006);
  };

  private GetOrCreateStone(point: OthelloPoint): OthelloStone {
    const key = point.y * BOARD_SIZE + point.x;
    let stone = this.stones.get(key);
    if (!stone) {
      stone = new OthelloStone();
      stone.position.set(point.x * CELL_SIZE + CELL_SIZE / 2, point.y * CELL_SIZE + CELL_SIZE / 2);
      this.stones.set(key, stone);
      this.stone_layer.addChild(stone);
    }
    return stone;
  }

  // cells 기준으로 돌을 연출 없이 바로 맞춘다(새 판/재접속 복원).
  private SyncStonesWithoutAnimation(): void {
    for (const stone of this.stones.values()) stone.destroy();
    this.stones.clear();
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const cell = this.cells[y][x];
        if (cell !== null) this.GetOrCreateStone({ x, y }).SetColor(cell);
      }
    }
    this.RedrawMarker();
  }

  // 마지막으로 놓인 자리 표시(작은 빨간 점).
  private RedrawMarker(): void {
    this.marker.clear();
    if (!this.last_move) return;
    this.marker
      .circle(this.last_move.x * CELL_SIZE + CELL_SIZE / 2, this.last_move.y * CELL_SIZE + CELL_SIZE / 2, 6)
      .fill(CUTE_COLOR.red)
      .stroke({ color: 0xffffff, width: 2 });
  }

  private RedrawHints(): void {
    this.hint_layer.clear();
    for (const hint of this.hints) {
      const center_x = hint.x * CELL_SIZE + CELL_SIZE / 2;
      const center_y = hint.y * CELL_SIZE + CELL_SIZE / 2;
      this.hint_layer
        .circle(center_x, center_y, STONE_RADIUS - 6)
        .fill({ color: 0xffffff, alpha: 0.35 })
        .stroke({ color: COLOR_HINT, width: 4 })
        .circle(center_x, center_y, 7)
        .fill(COLOR_HINT);
    }
  }
}

// 돌 하나 — 옆면(두께)이 있는 원반을 위에서 본 모양. 뒤집기는 원반을 좌우로 납작하게(scale.x) 줄였다 펴며
// 가운데에서 앞뒷면을 바꾸고, 그동안 살짝 들어 올려 그림자를 멀어지게 해서 3D 로 뒤집히는 것처럼 보이게 한다.
class OthelloStone extends Container {
  private readonly shadow = new Graphics();
  private readonly disc = new Container();
  private readonly black_face = OthelloStone.CreateFace(0x2b2b33, 0x15151a, 0x5a5a66);
  private readonly white_face = OthelloStone.CreateFace(0xfdfdfd, 0xd2d2d2, 0xffffff);
  // 거의 옆으로 섰을 때 보이는 돌의 두께(옆면).
  private readonly rim = new Graphics();
  private color: OthelloColor = OthelloColor.BLACK;
  private flip_from: OthelloColor = OthelloColor.BLACK;
  private flip_elapsed_ms = Number.POSITIVE_INFINITY;
  private flip_delay_ms = 0;
  private drop_elapsed_ms = Number.POSITIVE_INFINITY;

  constructor() {
    super();
    this.shadow.ellipse(0, 6, STONE_RADIUS, STONE_RADIUS * 0.9).fill({ color: 0x000000, alpha: 0.25 });
    this.rim.roundRect(-5, -STONE_RADIUS, 10, STONE_RADIUS * 2, 5).fill(0x8a8a8a);
    this.rim.visible = false;
    this.disc.addChild(this.black_face, this.white_face);
    this.addChild(this.shadow, this.disc, this.rim);
    this.ApplyFace(this.color);
  }

  public SetColor(color: OthelloColor): void {
    this.color = color;
    this.flip_elapsed_ms = Number.POSITIVE_INFINITY;
    this.ApplyFace(color);
    this.ApplyPose(0, 1);
  }

  public PlayDrop(): void {
    this.drop_elapsed_ms = 0;
    this.Update(0);
  }

  public FlipTo(color: OthelloColor, delay_ms: number): void {
    if (color === this.color && this.flip_elapsed_ms === Number.POSITIVE_INFINITY) return;
    this.flip_from = this.color;
    this.color = color;
    this.flip_delay_ms = delay_ms;
    this.flip_elapsed_ms = 0;
  }

  public Update(delta_ms: number): void {
    if (this.drop_elapsed_ms < DROP_MS) {
      this.drop_elapsed_ms += delta_ms;
      const t = Math.min(1, this.drop_elapsed_ms / DROP_MS);
      // 떨어지다가 바닥에서 살짝 통 튄다.
      const lift = (1 - EaseOutBounce(t)) * DROP_HEIGHT_PX;
      this.alpha = Math.min(1, t * 3);
      this.ApplyPose(lift, 1);
      return;
    }

    if (this.flip_elapsed_ms === Number.POSITIVE_INFINITY) return;
    this.flip_elapsed_ms += delta_ms;
    const elapsed = this.flip_elapsed_ms - this.flip_delay_ms;
    if (elapsed < 0) return;

    const t = Math.min(1, elapsed / FLIP_MS);
    const angle = t * Math.PI;
    // 앞면 → (옆면) → 뒷면. 가운데를 지나면 새 색으로 바꾼다.
    this.ApplyFace(t < 0.5 ? this.flip_from : this.color);
    this.ApplyPose(Math.sin(angle) * FLIP_LIFT_PX, Math.cos(angle));
    if (t >= 1) {
      this.flip_elapsed_ms = Number.POSITIVE_INFINITY;
      this.ApplyPose(0, 1);
    }
  }

  // lift: 들린 높이(px), width_factor: 원반 가로 비율(cos — 음수여도 크기만 쓴다).
  private ApplyPose(lift: number, width_factor: number): void {
    const width_scale = Math.max(0.04, Math.abs(width_factor));
    this.disc.scale.set(width_scale, 1 + (lift / FLIP_LIFT_PX) * 0.08);
    this.disc.y = -lift;
    this.rim.y = -lift;
    this.rim.visible = width_scale < 0.3;
    this.rim.alpha = 1 - width_scale / 0.3;
    this.rim.scale.y = this.disc.scale.y;
    // 높이 들수록 그림자는 작고 옅어진다.
    const shadow_scale = 1 - (lift / DROP_HEIGHT_PX) * 0.35;
    this.shadow.scale.set(shadow_scale * Math.max(0.3, width_scale), shadow_scale);
    this.shadow.alpha = shadow_scale;
  }

  private ApplyFace(color: OthelloColor): void {
    this.black_face.visible = color === OthelloColor.BLACK;
    this.white_face.visible = color === OthelloColor.WHITE;
  }

  // 원반 한 면: 옆면(아래로 살짝 보이는 두께) + 윗면 + 왼쪽 위 반사광.
  private static CreateFace(top: number, side: number, gloss: number): Graphics {
    return new Graphics()
      .circle(0, 4, STONE_RADIUS)
      .fill(side)
      .circle(0, 0, STONE_RADIUS)
      .fill(top)
      .stroke({ color: side, width: 2 })
      .ellipse(-STONE_RADIUS * 0.32, -STONE_RADIUS * 0.4, STONE_RADIUS * 0.42, STONE_RADIUS * 0.24)
      .fill({ color: gloss, alpha: 0.55 });
  }
}

// 바닥에 떨어져 통통 튀는 이징(0~1).
function EaseOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
