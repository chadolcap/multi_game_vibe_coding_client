// 화면 조이스틱 — 둥근 판 위의 손잡이를 끌어 방향과 세기를 낸다. 순수 Pixi Container 라 입력 처리는 씬이 맡고,
// 씬이 판 가운데 기준 좌표를 SetKnob() 에 넘기면 손잡이를 옮기고 -1~1 벡터를 돌려준다.
import { Container, Graphics } from "pixi.js";

export interface JoystickVector {
  x: number; // 오른쪽 +
  y: number; // 아래쪽 +
}

export class VirtualJoystick extends Container {
  public readonly radius: number;
  private readonly knob: Graphics;

  constructor(radius = 100) {
    super();
    this.radius = radius;
    const base = new Graphics()
      .circle(0, 0, radius)
      .fill({ color: 0xffffff, alpha: 0.28 })
      .stroke({ color: 0xffffff, alpha: 0.75, width: 6 });
    this.knob = new Graphics()
      .circle(0, 0, radius * 0.45)
      .fill(0xfff4dc)
      .stroke({ color: 0xf28b3c, width: 6 });
    this.addChild(base, this.knob);
  }

  // dx, dy = 판 가운데에서 손가락까지의 거리. 판 밖으로 나가면 가장자리에 붙인다.
  public SetKnob(dx: number, dy: number): JoystickVector {
    const length = Math.hypot(dx, dy);
    const scale = length > this.radius ? this.radius / length : 1;
    this.knob.position.set(dx * scale, dy * scale);
    return { x: (dx * scale) / this.radius, y: (dy * scale) / this.radius };
  }

  public Reset(): void {
    this.knob.position.set(0, 0);
  }
}
