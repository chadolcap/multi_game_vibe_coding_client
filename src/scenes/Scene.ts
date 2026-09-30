import type { Container } from "pixi.js";

// 씬 하나가 갖춰야 할 최소 규약. 화면 크기는 SceneManager 가 Resize() 로 알려준다.
export interface Scene {
  readonly view: Container;
  Resize(width: number, height: number): void;
  Destroy(): void;
}
