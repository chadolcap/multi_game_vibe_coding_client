// 최종 결과 때 화면 위에서 색종이가 흩날리며 떨어지는 연출.
// Play() 하면 SPAWN_DURATION_MS 동안 색종이를 뿌리고, 화면 아래로 떨어진 조각은 스스로 지운다.
// 클릭을 가로채지 않도록 eventMode 는 none 이다(결과 팝업 버튼 위로 떨어져도 눌린다).
import { Container, Graphics, Ticker } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";
import { CUTE_COLOR } from "./CuteTheme";

const SPAWN_DURATION_MS = 2600;
// 1초에 뿌리는 조각 수.
const SPAWN_PER_SEC = 70;
// 처음 터질 때 한꺼번에 뿌리는 조각 수.
const BURST_COUNT = 60;
const GRAVITY = 0.0009; // px/ms²
const MAX_FALL_SPEED = 0.42; // px/ms
const COLORS = [CUTE_COLOR.red, CUTE_COLOR.orange, CUTE_COLOR.yellow, CUTE_COLOR.mint, CUTE_COLOR.shirt, CUTE_COLOR.pink, 0xffffff];

interface Piece {
  view: Graphics;
  vx: number;
  vy: number;
  spin: number;
  // 종이가 뒤집히며 팔랑이는 효과(scale.y 를 cos 로 흔든다).
  flip_speed: number;
  sway_phase: number;
  age_ms: number;
}

export class Confetti extends Container {
  private readonly pieces: Piece[] = [];
  private spawn_left_ms = 0;
  private spawn_carry = 0;

  constructor() {
    super();
    this.eventMode = "none";
    Ticker.shared.add(this.OnTick);
  }

  public Play(): void {
    this.spawn_left_ms = SPAWN_DURATION_MS;
    for (let i = 0; i < BURST_COUNT; i++) this.Spawn(true);
  }

  // 남은 조각까지 모두 지운다(재시작/나가기 등으로 화면이 바뀔 때).
  public Stop(): void {
    this.spawn_left_ms = 0;
    for (const piece of this.pieces) piece.view.destroy();
    this.pieces.length = 0;
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  // burst: 첫 폭발 — 화면 위쪽 넓은 범위에서 위로 튀어 오르듯 시작한다.
  private Spawn(burst: boolean): void {
    const width = 8 + Math.random() * 8;
    const height = width * (0.5 + Math.random() * 0.5);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const view = new Graphics();
    if (Math.random() < 0.25) {
      view.circle(0, 0, width / 2).fill(color);
    } else {
      view.rect(-width / 2, -height / 2, width, height).fill(color);
    }
    view.position.set(Math.random() * GAME_WIDTH, burst ? Math.random() * 200 - 60 : -20);
    view.rotation = Math.random() * Math.PI * 2;
    this.addChild(view);

    this.pieces.push({
      view,
      vx: (Math.random() - 0.5) * (burst ? 0.5 : 0.15),
      vy: burst ? -(0.15 + Math.random() * 0.35) : Math.random() * 0.1,
      spin: (Math.random() - 0.5) * 0.012,
      flip_speed: 0.004 + Math.random() * 0.008,
      sway_phase: Math.random() * Math.PI * 2,
      age_ms: 0,
    });
  }

  private readonly OnTick = (ticker: Ticker): void => {
    const delta_ms = ticker.deltaMS;

    if (this.spawn_left_ms > 0) {
      this.spawn_left_ms -= delta_ms;
      this.spawn_carry += (SPAWN_PER_SEC * delta_ms) / 1000;
      while (this.spawn_carry >= 1) {
        this.Spawn(false);
        this.spawn_carry -= 1;
      }
    }

    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      piece.age_ms += delta_ms;
      piece.vy = Math.min(MAX_FALL_SPEED, piece.vy + GRAVITY * delta_ms);
      // 공기 저항처럼 옆 속도는 점점 줄고, 좌우로 살랑살랑 흔들린다.
      piece.vx *= 0.995;
      const sway = Math.sin(piece.age_ms * 0.004 + piece.sway_phase) * 0.06;
      piece.view.x += (piece.vx + sway) * delta_ms;
      piece.view.y += piece.vy * delta_ms;
      piece.view.rotation += piece.spin * delta_ms;
      piece.view.scale.y = Math.cos(piece.age_ms * piece.flip_speed);

      if (piece.view.y > GAME_HEIGHT + 30) {
        piece.view.destroy();
        this.pieces.splice(i, 1);
      }
    }
  };
}
