// 씬 전환 사이(로비 종료 ~ 게임 채널 접속 완료)에 보여주는 전체 화면 로딩 표시.
// SceneManager 가 씬이 바뀔 때마다 맨 위로 올려주므로, 어떤 씬 위에서도 계속 보인다.
import { Container, Graphics, Text, Ticker } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT } from "../config";

const SPINNER_RADIUS = 28;

export class LoadingOverlay extends Container {
  private readonly spinner: Graphics;
  private readonly label_text: Text;
  private elapsed = 0;
  private readonly tick = (ticker: Ticker): void => {
    if (!this.visible) return;
    this.elapsed += ticker.deltaTime;
    this.spinner.rotation = this.elapsed * 0.15;
  };

  constructor() {
    super();
    this.visible = false;

    const dim = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.75 });
    dim.eventMode = "static"; // 로딩 중엔 뒤쪽 클릭 차단

    this.spinner = new Graphics().arc(0, 0, SPINNER_RADIUS, 0, Math.PI * 1.5).stroke({ width: 6, color: 0x8fa3ff });
    this.spinner.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30);

    this.label_text = new Text({
      text: "로딩 중...",
      style: { fill: 0xffffff, fontSize: 22, fontFamily: "sans-serif" },
    });
    this.label_text.anchor.set(0.5, 0);
    this.label_text.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20);

    this.addChild(dim, this.spinner, this.label_text);

    Ticker.shared.add(this.tick);
  }

  public Show(message = "로딩 중..."): void {
    this.label_text.text = message;
    this.visible = true;
  }

  public Hide(): void {
    this.visible = false;
  }

  public DestroyOverlay(): void {
    Ticker.shared.remove(this.tick);
  }
}
