// 관리자 SEND_NOTICE 공지를 화면 맨 위에 빨간 바 + 오른쪽에서 왼쪽으로 흘러가는(마퀴) 텍스트로 보여준다.
// LoadingOverlay 와 같은 방식으로 SceneManager 의 overlay 로 등록해 씬이 바뀌어도 계속 최상단에 남는다.
import { Container, Graphics, Text, Ticker } from "pixi.js";
import { GAME_WIDTH } from "../config";

const BAR_HEIGHT = 40;
const SCROLL_SPEED = 2; // 프레임당(60fps 기준) 이동 픽셀

export class NoticeBanner extends Container {
  private readonly label_text: Text;
  private readonly tick = (ticker: Ticker): void => {
    if (!this.visible) return;
    this.label_text.x -= SCROLL_SPEED * ticker.deltaTime;
    // 텍스트가 완전히 왼쪽으로 빠져나가면 한 번만 보여주고 숨긴다(반복 재생 안 함).
    if (this.label_text.x < -this.label_text.width) {
      this.visible = false;
    }
  };

  constructor() {
    super();
    this.visible = false;

    const bar = new Graphics().rect(0, 0, GAME_WIDTH, BAR_HEIGHT).fill(0xcc2222);

    this.label_text = new Text({
      text: "",
      style: { fill: 0xffffff, fontSize: 20, fontFamily: "sans-serif", fontWeight: "bold" },
    });
    this.label_text.anchor.set(0, 0.5);
    this.label_text.position.set(GAME_WIDTH, BAR_HEIGHT / 2);

    this.addChild(bar, this.label_text);
    Ticker.shared.add(this.tick);
  }

  // 새 공지가 오면 이 자리에서 다시 오른쪽부터 흘러오도록 위치를 초기화한다.
  public Show(message: string): void {
    this.label_text.text = message;
    this.label_text.x = GAME_WIDTH;
    this.visible = true;
  }

  public DestroyBanner(): void {
    Ticker.shared.remove(this.tick);
  }
}
