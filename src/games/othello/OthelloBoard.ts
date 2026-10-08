// 오델로 8x8 보드 — 돌 그리기, 놓을 수 있는 자리 표시, 자리 클릭 처리만 담당한다.
// 규칙(합법수/뒤집기) 판정은 서버가 한다: TURN_START 의 can 으로 놓을 자리를 받고, SELECT_GAME 결과의
// change 로 뒤집을 돌을 받으므로 이 컴포넌트는 받은 좌표를 그대로 그리기만 한다. 서버/네트워크는 모른다.
import { Container, Graphics, Rectangle } from "pixi.js";
import { OthelloColor, type OthelloPoint } from "./types";

const BOARD_SIZE = 8;
const CELL_SIZE = 80;
export const OTHELLO_BOARD_PIXEL_SIZE = BOARD_SIZE * CELL_SIZE;

const COLOR_BOARD = 0x1f7a3e;
const COLOR_LINE = 0x14532b;
const COLOR_BLACK_STONE = 0x111111;
const COLOR_WHITE_STONE = 0xf5f5f5;
const COLOR_HINT = 0xffe066;
const COLOR_LAST_MOVE = 0xff4d4d;

type Cell = OthelloColor | null;

export interface OthelloBoardOptions {
  // 놓을 수 있는 자리로 표시된 칸을 눌렀을 때 호출된다.
  onSelect: (point: OthelloPoint) => void;
}

export class OthelloBoard extends Container {
  private cells: Cell[][] = [];
  private hints: OthelloPoint[] = [];
  private last_move: OthelloPoint | null = null;
  private readonly stone_layer = new Graphics();
  private readonly hint_layer = new Graphics();

  constructor(options: OthelloBoardOptions) {
    super();

    const background = new Graphics().roundRect(0, 0, OTHELLO_BOARD_PIXEL_SIZE, OTHELLO_BOARD_PIXEL_SIZE, 8).fill(COLOR_BOARD);
    for (let i = 0; i <= BOARD_SIZE; i++) {
      const offset = i * CELL_SIZE;
      background.moveTo(offset, 0).lineTo(offset, OTHELLO_BOARD_PIXEL_SIZE);
      background.moveTo(0, offset).lineTo(OTHELLO_BOARD_PIXEL_SIZE, offset);
    }
    background.stroke({ width: 2, color: COLOR_LINE });

    this.addChild(background, this.stone_layer, this.hint_layer);

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
    this.Redraw();
  }

  // GAME_STATUS(재접속 상태 복원) — 보드를 비우고 흰색/검정 돌 좌표 목록으로 통째로 다시 채운다.
  // 놓을 수 있는 자리 표시(hints)는 건드리지 않는다(TURN_START 가 GAME_STATUS 보다 먼저 올 수 있다).
  public SetStones(white_points: OthelloPoint[], black_points: OthelloPoint[]): void {
    this.cells = Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null));
    for (const point of white_points) this.cells[point.y][point.x] = OthelloColor.WHITE;
    for (const point of black_points) this.cells[point.y][point.x] = OthelloColor.BLACK;
    this.last_move = null;
    this.Redraw();
  }

  public PlaceStone(point: OthelloPoint, color: OthelloColor): void {
    this.cells[point.y][point.x] = color;
    this.last_move = point;
    this.Redraw();
  }

  // SELECT_GAME 결과의 change — 뒤집히는 상대 돌의 좌표를 모두 color 로 바꾼다.
  public FlipStones(points: OthelloPoint[], color: OthelloColor): void {
    for (const point of points) {
      this.cells[point.y][point.x] = color;
    }
    this.Redraw();
  }

  // 놓을 수 있는 자리를 표시하고, 그 칸만 클릭에 반응하게 한다. 빈 배열이면 표시와 클릭을 모두 끈다.
  public SetHints(points: OthelloPoint[]): void {
    this.hints = points;
    this.Redraw();
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

  private Redraw(): void {
    this.stone_layer.clear();
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const cell = this.cells[y][x];
        if (cell === null) continue;
        const stone_color = cell === OthelloColor.BLACK ? COLOR_BLACK_STONE : COLOR_WHITE_STONE;
        this.stone_layer
          .circle(x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2, CELL_SIZE / 2 - 8)
          .fill(stone_color)
          .stroke({ width: 2, color: 0x000000, alpha: 0.4 });
      }
    }
    if (this.last_move) {
      this.stone_layer
        .circle(this.last_move.x * CELL_SIZE + CELL_SIZE / 2, this.last_move.y * CELL_SIZE + CELL_SIZE / 2, 6)
        .fill(COLOR_LAST_MOVE);
    }

    this.hint_layer.clear();
    for (const hint of this.hints) {
      this.hint_layer
        .circle(hint.x * CELL_SIZE + CELL_SIZE / 2, hint.y * CELL_SIZE + CELL_SIZE / 2, 12)
        .fill({ color: COLOR_HINT, alpha: 0.85 });
    }
  }
}
