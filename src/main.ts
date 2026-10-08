import { Application } from "pixi.js";
import "./style.css";
import { SceneManager } from "./scenes/SceneManager";
import { LobbyScene } from "./scenes/LobbyScene";
import { RpsScene } from "./games/rps/RpsScene";
import { OthelloScene } from "./games/othello/OthelloScene";
import { GameId } from "./common/types";
import { LoadingOverlay } from "./ui/LoadingOverlay";
import { NoticeBanner } from "./ui/NoticeBanner";
import { GAME_WIDTH, GAME_HEIGHT } from "./config";
import type { GameHandoff } from "./scenes/LobbyScene";

// 캔버스 해상도는 720x1280 으로 고정하고, 실제 화면 크기에 맞춰 CSS 로만 배율을 조정한다
// (스마트폰마다 화면 비율이 달라도 게임 레이아웃 좌표는 항상 720x1280 기준으로 계산하면 된다).
function FitCanvasToWindow(canvas: HTMLCanvasElement): void {
  const scale = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT);
  canvas.style.width = `${GAME_WIDTH * scale}px`;
  canvas.style.height = `${GAME_HEIGHT * scale}px`;
}

async function Main(): Promise<void> {
  const app = new Application();
  await app.init({
    background: "#1a1a2e",
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    antialias: true,
  });

  const mount = document.querySelector<HTMLDivElement>("#app");
  if (!mount) throw new Error("#app 요소를 찾을 수 없습니다.");
  mount.appendChild(app.canvas);

  // 로비 종료 ~ 게임 채널 접속 완료 사이에 씬이 바뀌어도 계속 위에 떠 있어야 하는 로딩 화면.
  const loading_overlay = new LoadingOverlay();
  // 관리자 공지(SEND_NOTICE) — 로비/게임 어느 씬이든 화면 맨 위에 항상 뜰 수 있어야 한다.
  const notice_banner = new NoticeBanner();
  const scene_manager = new SceneManager(app, [loading_overlay, notice_banner]);

  // 게임에서 로비로 돌아가면 새 로비 씬을 만든다. 새 씬은 뜨자마자 스스로 로비 소켓 접속을 시도한다.
  function GoToLobby(): void {
    const lobby_scene = new LobbyScene({
      loading_overlay,
      notice_banner,
      onGameRoomReady: HandleGameRoomReady,
    });
    scene_manager.ChangeScene(lobby_scene);
  }

  // 로비에서 매칭이 성사되어 게임 채널 접속까지 끝나면 호출된다.
  function HandleGameRoomReady(handoff: GameHandoff): void {
    loading_overlay.Hide();
    // 게임 종류별로 씬 옵션은 같다 — 서버가 방 입장/준비/결과를 같은 규약으로 보내기 때문이다.
    const scene_options = {
      room: handoff.room,
      my_userid: handoff.my_userid,
      is_rejoin: handoff.is_rejoin,
      notice_banner,
      onExitToLobby: GoToLobby,
    };
    const game_scene = handoff.game === GameId.OTHELLO ? new OthelloScene(scene_options) : new RpsScene(scene_options);
    scene_manager.ChangeScene(game_scene);
  }

  GoToLobby();

  FitCanvasToWindow(app.canvas);
  window.addEventListener("resize", () => FitCanvasToWindow(app.canvas));
}

Main();
