import type { Application, Container } from "pixi.js";
import type { Scene } from "./Scene";

// 현재 화면에 떠 있는 씬 하나만 관리하는 단순한 매니저.
// overlays 는 로딩 화면처럼 씬이 바뀌어도 항상 맨 위에 남아 있어야 하는 것들이다.
export class SceneManager {
  private current: Scene | null = null;
  private readonly app: Application;
  private readonly overlays: Container[];

  constructor(app: Application, overlays: Container[] = []) {
    this.app = app;
    this.overlays = overlays;
  }

  public ChangeScene(scene: Scene): void {
    if (this.current) {
      this.app.stage.removeChild(this.current.view);
      this.current.Destroy();
    }
    this.current = scene;
    this.app.stage.addChild(scene.view);
    // addChild 는 이미 자식인 대상을 맨 뒤(=화면 맨 위)로 다시 옮겨준다.
    for (const overlay of this.overlays) {
      this.app.stage.addChild(overlay);
    }
    scene.Resize(this.app.screen.width, this.app.screen.height);
  }

  public Resize(width: number, height: number): void {
    this.current?.Resize(width, height);
  }
}
