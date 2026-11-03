// 로비 씬 — 씬이 뜨면 버튼 없이 바로 로비 소켓에 접속하고, 연결되면 바로 ENTER_LOBBY 를 보낸다.
// 소켓 연결에 실패하거나 끊어지면 팝업으로 알리고, '로비로 접속' 버튼으로 다시 접속하게 한다.
// 응답의 name 이 비어 있으면 별명 등록 팝업을 띄운다. 다 끝나면 3D 섬(LobbyWorld)에서 오리를 걷게 한다.
// 왼쪽 아래 조이스틱으로 걷고, 그 밖의 화면을 끌면 시점이 돈다(두 손가락은 확대/축소). 건물 앞에 가면 입장 버튼이 뜨고,
// 가운데 분수에서는 내정보/랭킹 메뉴를 연다.
// 통신 내용은 화면에 노출하지 않고 콘솔에만 출력한다.
import { Container, Graphics, Rectangle, Text, Ticker, type FederatedPointerEvent } from "pixi.js";
import { CloseCode, type Room } from "@colyseus/sdk";
import type { Scene } from "./Scene";
import { Button } from "../ui/Button";
import { NicknamePopup } from "../ui/NicknamePopup";
import { VirtualJoystick } from "../ui/VirtualJoystick";
import { InfoPopup, STAR_SHORTAGE_MESSAGE, STAR_SHORTAGE_TITLE } from "../ui/InfoPopup";
import { ConnectionLostPopup } from "../ui/ConnectionLostPopup";
import { GameSelect, GetGameLabel, SELECT_WIDTH } from "../ui/GameSelect";
import { CUTE_COLOR, CUTE_FONT_FAMILY, CUTE_THEME, CreateCuteBackground } from "../ui/CuteTheme";
import { GAME_HEIGHT, GAME_WIDTH } from "../config";
import { LobbyWorld } from "../lobby3d/LobbyWorld";
import type { LobbyPlace } from "../lobby3d/lobbyPlaces";
import type { LoadingOverlay } from "../ui/LoadingOverlay";
import type { NoticeBanner } from "../ui/NoticeBanner";
import { LobbyConnection } from "../network/LobbyConnection";
import { GetQueryParam } from "../common/urlParams";
import { ParseGameIdFromRoomName } from "../common/channelNames";
import { ShowRewardedAd } from "../ads/AdService";
import {
  GameId,
  type EnterLobbyPayload,
  type EnterLobbyResultPayload,
  type AdViewCompleteResultPayload,
  type MatchFoundPayload,
  type NameResultPayload,
  type PlayInfoPayload,
  type RejoinGamePayload,
  type RankEntry,
  type MyRankInfo,
} from "../common/types";

// 통신 규약 문서(계속 갱신됨, 항상 최신 내용을 다시 확인할 것):
// d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx ("통신규약" 시트)
// mid 는 접속 URL 의 쿼리 파라미터로 받는다 (예: http://localhost:5173/?mid=10000).
// 없으면 문서의 예시 값으로 대체한다.
const DEFAULT_MID = "10000";

function BuildEnterLobbyPayload(): EnterLobbyPayload {
  return {
    partner: "ocb",
    mid: GetQueryParam("mid") ?? DEFAULT_MID,
    gender: "M",
    phone: "iphone17pro max",
  };
}

// ENTER_LOBBY 실패(error) 코드 — 문서 + 서버 확인란 기준
const ENTER_LOBBY_ERROR_MESSAGES: Record<number, string> = {
  1: "형식에 맞지 않은 정보입니다.",
  2: "이미 접속 중인 계정입니다.",
  3: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  4: "알 수 없는 오류가 발생했습니다.",
};

// NAME 실패(error) 코드 — 문서 + 서버 확인란 기준 (3번은 문서에 없지만 서버가 추가로 보낸다고 확인해줌)
const NAME_ERROR_MESSAGES: Record<number, string> = {
  1: "이미 다른 사용자가 사용 중인 별명입니다.",
  2: "사용할 수 없는 별명입니다.",
  3: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

// JOIN_MATCH 실패(error) 코드 — 문서 기준
const JOIN_MATCH_ERROR_MESSAGES: Record<number, string> = {
  1: "접속 가능한 게임방이 없습니다. 잠시 후 다시 시도해 주세요.",
  2: "매칭 중 오류가 발생했습니다.",
};

// AD_VIEW_COMPLETE 실패(error) 코드 — 1=10초 안에 다시 보냄, 2=서버 오류. 둘 다 같은 안내를 한다(서버 docs/HANDOFF.md).
const AD_VIEW_ERROR_MESSAGE = "잠시 후 다시 시도해 주세요.";

const LOG_TAG = "[Lobby]";

// 화면 세로 배치(720x1280 기준). 메뉴 카드(게임 선택 + 버튼)는 분수에서 열 때만 뜨고, 입장 버튼은 화면 아래에 뜬다.
const MENU_CARD_WIDTH = 540;
const MENU_CARD_Y = 520;
const MENU_CARD_HEIGHT = 460;
// 입장/매칭 취소 버튼과 상태 문구는 화면 위쪽(star 줄 아래)에 둔다 — 아래쪽은 조이스틱과 시점 회전에 쓴다.
const STATUS_Y = 210;
const GATE_PASSED_MESSAGE = "무료 입장! 건물 앞으로 걸어가 보세요.";
const PLACE_BUTTON_WIDTH = 540;
const PLACE_BUTTON_HEIGHT = 96;
const PLACE_BUTTON_Y = 96;
// 왼쪽 아래 조이스틱. 판 가운데에서 JOYSTICK_TOUCH_RADIUS 안을 누르면 조이스틱, 그 밖은 시점 회전이다.
const JOYSTICK_RADIUS = 100;
const JOYSTICK_X = 150;
const JOYSTICK_Y = 1110;
const JOYSTICK_TOUCH_RADIUS = 190;
// 마우스 휠 한 칸에 확대/축소하는 비율 (PC 용)
const WHEEL_ZOOM_STEP = 1.1;
// PC 이동 키 → 조이스틱 방향(x 오른쪽, y 아래쪽). event.code 라 한글 입력 상태에서도 같은 키로 동작한다.
const MOVE_KEY_DIRECTIONS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
// 상태 문구가 화면 양옆을 넘지 않도록 좌우 여백을 둔 줄바꿈 폭.
const STATUS_WRAP_WIDTH = MENU_CARD_WIDTH - 60;
// 화면 왼쪽 위 — 보유 star + '광고 보기' 버튼 한 줄 (타이틀보다 위).
const STAR_ROW_X = 24;
const STAR_ROW_Y = 16;
const STAR_ROW_HEIGHT = 60;
const AD_BUTTON_X = STAR_ROW_X + 130;
// star 획득 연출(+1)이 위로 떠오르며 사라지는 시간과 거리.
const STAR_GAIN_EFFECT_MS = 1000;
const STAR_GAIN_EFFECT_RISE = 40;

// PLAY_INFO 응답을 '내정보 보기' 팝업용 줄글로 바꾼다. result 는 성공 여부라 화면에 보여주지 않고,
// 첫 줄에 어느 게임의 전적인지 게임 이름을 쓴다.
function FormatPlayInfo(game: GameId, payload: PlayInfoPayload): string {
  if (payload.result === "N") return `${GetGameLabel(game)}\n\n전적 정보를 불러오지 못했습니다.`;
  // 청기백기(1인)는 win_count 에 이긴 판 수가 아니라 맞춘 문제 수를 쌓는다(엑셀 flag 시트 GAME_RESULT 비고).
  const win_label = game === GameId.FLAG ? "맞춘 문제 수" : "게임 승리 수";
  return [
    GetGameLabel(game),
    `전체 게임 참여 수 : ${payload.total_game_count}`,
    `전체 ${win_label} : ${payload.total_win_count}`,
    `오늘 게임 참여 수 : ${payload.today_game_count}`,
    `오늘 ${win_label} : ${payload.today_win_count}`,
  ].join("\n");
}

// RANK_DAILY/RANK_WEEKLY 의 list([별명, 점수] 튜플 배열)와 내 순위를 팝업용 줄글로 바꾼다.
function FormatRankList(list: RankEntry[], my: MyRankInfo): string {
  const lines = list.map(([name, score], index) => `${index + 1}위 · ${name} · ${score}점`);
  lines.push("", `내 순위: ${my.rank}위 (${my.score}점)`);
  return lines.join("\n");
}

// 게임 씬(RpsScene/OthelloScene)이 ENTER_ROOM 응답(player1/player2)에서 내 쪽을 구분할 수 있도록 my_userid 를 넘겨준다.
// name/avatar/win_per 는 ENTER_ROOM·OPPONENT_JOINED 응답에 이미 들어있어 따로 넘길 방법이 없다.
export interface GameHandoff {
  room: Room;
  // 어느 게임의 방인지 — main.ts 가 이 값으로 RpsScene/OthelloScene 중 어느 씬을 만들지 정한다.
  game: GameId;
  my_userid: string;
  // REJOIN_GAME 으로 들어온 경우 true — 이미 라운드가 진행 중이므로 RpsScene 이 '게임 준비' 버튼을
  // 보여주지 않고 대기 중 표시만 하도록 알려준다.
  is_rejoin: boolean;
}

export interface LobbySceneOptions {
  loading_overlay: LoadingOverlay;
  notice_banner: NoticeBanner;
  // Pixi 캔버스 — 3D 캔버스를 같은 크기로 맞춘다.
  overlay_canvas: HTMLCanvasElement;
  // 게임에서 돌아온 경우 그 게임 — 3D 섬에서 그 건물 앞에 세운다.
  return_game?: GameId;
  onGameRoomReady: (handoff: GameHandoff) => void;
}

export class LobbyScene implements Scene {
  readonly view = new Container();

  private readonly status: Text;
  // 3D 섬. 3D 를 쓸 수 없는 기기(WebGL 생성 실패)면 null — 그때는 예전처럼 카드 메뉴로 게임에 들어간다.
  private world: LobbyWorld | null = null;
  // 3D 섬 터치를 받는 투명 판 (모든 UI 보다 아래)
  private readonly world_touch_layer = new Graphics();
  private readonly joystick = new VirtualJoystick(JOYSTICK_RADIUS);
  // 손가락마다 따로 본다 — 왼손 조이스틱과 오른손 시점 회전을 동시에 할 수 있다
  private joystick_pointer: number | null = null;
  private readonly camera_pointers = new Map<number, { x: number; y: number }>();
  private pinch_distance: number | null = null;
  private readonly wheel = (event: WheelEvent) => this.OnWheel(event);
  // PC 방향키·WASD 로 누르고 있는 키
  private readonly pressed_move_keys = new Set<string>();
  private readonly key_down = (event: KeyboardEvent) => this.OnKeyDown(event);
  private readonly key_up = (event: KeyboardEvent) => this.OnKeyUp(event);
  // 창이 포커스를 잃으면 keyup 이 오지 않아 계속 걷게 되므로 모두 뗀 것으로 본다
  private readonly window_blur = () => {
    this.pressed_move_keys.clear();
    this.ApplyKeyboardMove();
  };
  // 지금 오리가 서 있는 곳 근처의 건물
  private near_place: LobbyPlace | null = null;
  // 건물 입장 / 분수 메뉴 열기 버튼
  private readonly place_button: Button;
  private readonly close_menu_button: Button;
  private is_main_ui_shown = false;
  private is_menu_open = false;
  private is_matching = false;
  // 마지막으로 JOIN_MATCH 를 보낸 게임
  private match_game: GameId = GameId.RPS;
  // 게임 선택 + 버튼을 올려 두는 크림색 카드.
  private readonly menu_card: Graphics;
  private readonly nickname_popup = new NicknamePopup(CUTE_THEME);
  private readonly info_popup = new InfoPopup(CUTE_THEME);
  // 서버가 꺼졌거나 연결이 끊겨 로비 통신이 안 될 때 — 버튼으로 로비에 다시 접속하게 유도한다.
  private readonly connection_lost_popup = new ConnectionLostPopup({
    button_label: "로비로 접속",
    onConfirm: () => this.ReconnectToLobby(),
    theme: CUTE_THEME,
  });
  private readonly game_select = new GameSelect(CUTE_THEME);
  private game_select_hidden_by_popup = false;
  private readonly my_info_button: Button;
  private readonly join_match_button: Button;
  private readonly cancel_match_button: Button;
  private readonly rank_daily_button: Button;
  private readonly rank_weekly_button: Button;
  // 보유 star — ENTER_LOBBY.star 로 초기화하고, AD_VIEW_COMPLETE 응답의 star 로 항상 덮어쓴다(클라이언트에서 더하지 않음).
  private readonly star_text: Text;
  private star = 0;
  private readonly ad_button: Button;
  private readonly connection = new LobbyConnection();
  private readonly options: LobbySceneOptions;
  private my_userid = "";
  // ENTER_LOBBY 실패(result:N) 문구. 서버는 실패 응답 직후 연결을 끊으므로(WITH_ERROR), onLeave 에서
  // 일반 "연결 끊김" 대신 이 문구(중복 접속 등)를 팝업으로 보여준다. 새로 접속할 때마다 비운다.
  private enter_lobby_error_message: string | null = null;
  // 마지막으로 PLAY_INFO 를 요청한 게임 — 응답에는 game 이 없고, 응답이 오기 전에 선택이 바뀔 수 있어 요청 때 기억해 둔다.
  private play_info_game: GameId = GameId.RPS;

  constructor(options: LobbySceneOptions) {
    this.options = options;
    this.status = new Text({
      text: "대기 중",
      style: {
        fill: CUTE_COLOR.brown,
        fontSize: 24,
        fontFamily: CUTE_FONT_FAMILY,
        wordWrap: true,
        wordWrapWidth: STATUS_WRAP_WIDTH,
        align: "center",
        stroke: { color: 0xffffff, width: 6, join: "round" },
      },
    });

    this.menu_card = new Graphics()
      .roundRect(0, 8, MENU_CARD_WIDTH, MENU_CARD_HEIGHT, 32)
      .fill({ color: 0x000000, alpha: 0.08 })
      .roundRect(0, 0, MENU_CARD_WIDTH, MENU_CARD_HEIGHT, 32)
      .fill(CUTE_COLOR.cream)
      .stroke({ color: CUTE_COLOR.shirt, width: 6 });

    this.my_info_button = new Button({
      label: "내정보 보기",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.OnClickMyInfo(),
    });
    this.join_match_button = new Button({
      label: "게임 참여",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.OnClickJoinMatch(),
    });
    this.cancel_match_button = new Button({
      label: "매칭 취소",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.OnClickCancelMatch(),
    });
    this.rank_daily_button = new Button({
      label: "일간 랭킹",
      width: 210,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.OnClickRankDaily(),
    });
    this.rank_weekly_button = new Button({
      label: "주간 랭킹",
      width: 210,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.OnClickRankWeekly(),
    });
    this.close_menu_button = new Button({
      label: "닫기",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.CloseMenu(),
    });
    this.place_button = new Button({
      label: "",
      width: PLACE_BUTTON_WIDTH,
      height: PLACE_BUTTON_HEIGHT,
      theme: CUTE_THEME,
      onClick: () => this.OnClickPlace(),
    });
    this.menu_card.visible = false;
    this.my_info_button.visible = false;
    this.join_match_button.visible = false;
    this.cancel_match_button.visible = false;
    this.rank_daily_button.visible = false;
    this.rank_weekly_button.visible = false;
    this.close_menu_button.visible = false;
    this.place_button.visible = false;

    this.star_text = new Text({
      text: "★ 0",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 32,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 7, join: "round" },
      },
    });
    this.star_text.anchor.set(0, 0.5);
    this.ad_button = new Button({
      label: "광고 보기",
      width: 170,
      height: STAR_ROW_HEIGHT,
      theme: CUTE_THEME,
      onClick: () => void this.OnClickWatchAd(),
    });
    this.star_text.visible = false;
    this.ad_button.visible = false;

    this.CreateWorld();
    this.world_touch_layer.hitArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.world_touch_layer.eventMode = "static";
    this.world_touch_layer.on("pointerdown", (event) => this.OnControlDown(event));
    this.world_touch_layer.on("globalpointermove", (event) => this.OnControlMove(event));
    this.world_touch_layer.on("pointerup", (event) => this.OnControlUp(event));
    this.world_touch_layer.on("pointerupoutside", (event) => this.OnControlUp(event));
    this.joystick.position.set(JOYSTICK_X, JOYSTICK_Y);
    this.joystick.eventMode = "none"; // 입력은 아래 투명 판이 받는다
    this.joystick.visible = false;
    if (this.world) {
      window.addEventListener("wheel", this.wheel, { passive: true });
      window.addEventListener("keydown", this.key_down);
      window.addEventListener("keyup", this.key_up);
      window.addEventListener("blur", this.window_blur);
    }

    this.view.addChild(
      this.world ? this.world_touch_layer : CreateCuteBackground(),
      this.joystick,
      this.menu_card,
      this.status,
      this.game_select,
      this.my_info_button,
      this.join_match_button,
      this.close_menu_button,
      this.place_button,
      this.cancel_match_button,
      this.rank_daily_button,
      this.rank_weekly_button,
      this.star_text,
      this.ad_button,
      this.nickname_popup,
      this.info_popup,
      this.connection_lost_popup
    );

    // GameSelect 의 HTML <select> 는 캔버스 위에 떠 있어 팝업에 가려지지 않으므로, 팝업이 닫힐 때 복원한다.
    this.info_popup.on_close = () => {
      if (this.game_select_hidden_by_popup) {
        this.game_select_hidden_by_popup = false;
        this.game_select.Show();
      }
    };

    // 버튼 없이, 씬이 만들어지면 바로 로비 소켓 접속을 시도한다.
    void this.ConnectToLobby();
  }

  private CreateWorld(): void {
    const mount = document.querySelector<HTMLDivElement>("#app");
    if (!mount) return;
    try {
      this.world = new LobbyWorld(mount, {
        overlay_canvas: this.options.overlay_canvas,
        return_game: this.options.return_game,
        onNearPlaceChanged: (place) => {
          this.near_place = place;
          // 건물에 도착하면 입장 안내는 할 일을 다 했다 (다른 상태 문구는 지우지 않는다).
          if (place && this.status.text === GATE_PASSED_MESSAGE) this.SetStatus("");
          this.UpdatePlaceButton();
        },
        onGatePassed: () => this.SetStatus(GATE_PASSED_MESSAGE),
        onPlayerMoved: (x, z) => this.connection.SendLobbyMove(x, z),
      });
    } catch (error) {
      console.error(`${LOG_TAG} 3D 로비 생성 실패 ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 메인 화면이고 메뉴가 닫혀 있을 때만 걷고 시점을 돌린다.
  private CanControlWorld(): boolean {
    return this.world !== null && this.is_main_ui_shown && !this.is_menu_open;
  }

  private OnControlDown(event: FederatedPointerEvent): void {
    if (!this.CanControlWorld()) return;
    const position = this.world_touch_layer.toLocal(event.global);
    const from_joystick = Math.hypot(position.x - JOYSTICK_X, position.y - JOYSTICK_Y);
    if (this.joystick_pointer === null && from_joystick <= JOYSTICK_TOUCH_RADIUS) {
      this.joystick_pointer = event.pointerId;
      this.MoveJoystick(position.x, position.y);
      return;
    }
    this.camera_pointers.set(event.pointerId, { x: position.x, y: position.y });
    this.pinch_distance = null;
  }

  private OnControlMove(event: FederatedPointerEvent): void {
    if (!this.CanControlWorld()) return;
    const position = this.world_touch_layer.toLocal(event.global);
    if (event.pointerId === this.joystick_pointer) {
      this.MoveJoystick(position.x, position.y);
      return;
    }
    const previous = this.camera_pointers.get(event.pointerId);
    if (!previous) return;
    this.camera_pointers.set(event.pointerId, { x: position.x, y: position.y });

    // 한 손가락 = 회전, 두 손가락 = 확대/축소
    if (this.camera_pointers.size === 1) {
      this.world?.RotateCamera(position.x - previous.x, position.y - previous.y);
      return;
    }
    const [first, second] = [...this.camera_pointers.values()];
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    if (this.pinch_distance !== null && distance > 0) this.world?.ZoomCamera(this.pinch_distance / distance);
    this.pinch_distance = distance;
  }

  private OnControlUp(event: FederatedPointerEvent): void {
    if (event.pointerId === this.joystick_pointer) {
      this.joystick_pointer = null;
      // 키를 누르고 있으면 그 방향으로 이어서 걷는다
      this.ApplyKeyboardMove();
    }
    this.camera_pointers.delete(event.pointerId);
    this.pinch_distance = null;
  }

  private MoveJoystick(x: number, y: number): void {
    const vector = this.joystick.SetKnob(x - JOYSTICK_X, y - JOYSTICK_Y);
    this.world?.SetMoveInput(vector.x, vector.y);
  }

  // 메뉴를 열거나 화면을 떠날 때 — 누르고 있던 조이스틱·드래그를 놓은 것으로 친다.
  private ReleaseControls(): void {
    this.joystick_pointer = null;
    this.pressed_move_keys.clear();
    this.joystick.Reset();
    this.world?.SetMoveInput(0, 0);
    this.camera_pointers.clear();
    this.pinch_distance = null;
  }

  private UpdateJoystickVisible(): void {
    this.joystick.visible = this.CanControlWorld();
  }

  // PC 방향키·WASD — 화면 조이스틱을 그 방향 끝까지 민 것과 같다. 별명 입력 칸 등에 글자를 칠 때는 무시한다.
  private OnKeyDown(event: KeyboardEvent): void {
    if (!(event.code in MOVE_KEY_DIRECTIONS) || !this.CanControlWorld()) return;
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    event.preventDefault();
    if (this.pressed_move_keys.has(event.code)) return; // 키를 누르고 있으면 반복해서 온다
    this.pressed_move_keys.add(event.code);
    this.ApplyKeyboardMove();
  }

  private OnKeyUp(event: KeyboardEvent): void {
    if (!this.pressed_move_keys.delete(event.code)) return;
    this.ApplyKeyboardMove();
  }

  // 누르고 있는 키를 합쳐 이동 방향을 정한다. 화면 조이스틱을 잡고 있으면 그쪽이 우선이다.
  private ApplyKeyboardMove(): void {
    if (this.joystick_pointer !== null) return;
    let x = 0;
    let y = 0;
    for (const code of this.pressed_move_keys) {
      x += MOVE_KEY_DIRECTIONS[code][0];
      y += MOVE_KEY_DIRECTIONS[code][1];
    }
    const length = Math.hypot(x, y);
    if (length === 0) {
      this.joystick.Reset();
      this.world?.SetMoveInput(0, 0);
      return;
    }
    // 대각선도 같은 속도로 — 길이 1 로 맞춘 뒤 조이스틱 손잡이도 그 방향 끝에 보여 준다
    this.MoveJoystick(JOYSTICK_X + (x / length) * JOYSTICK_RADIUS, JOYSTICK_Y + (y / length) * JOYSTICK_RADIUS);
  }

  private OnWheel(event: WheelEvent): void {
    if (!this.CanControlWorld()) return;
    this.world?.ZoomCamera(event.deltaY > 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP);
  }

  // 오리 근처에 입장할 곳이 있고 다른 일을 하는 중이 아닐 때만 입장 버튼을 보여준다.
  private UpdatePlaceButton(): void {
    const place = this.near_place;
    this.place_button.visible = this.is_main_ui_shown && !this.is_menu_open && !this.is_matching && place !== null;
    if (!place?.action) return;
    this.place_button.SetLabel(
      place.action.kind === "game" ? `${place.label} · ${GetGameLabel(place.action.game)} 입장` : `${place.label} · 내정보/랭킹 보기`
    );
  }

  private OnClickPlace(): void {
    const action = this.near_place?.action;
    if (!action) return;
    if (action.kind === "game") {
      this.StartMatch(action.game);
      return;
    }
    this.OpenMenu();
  }

  // 분수 메뉴 — 게임을 골라 내 전적과 랭킹을 본다. 게임 입장은 건물에서 한다(3D 를 못 쓰면 여기서 입장한다).
  private OpenMenu(): void {
    this.is_menu_open = true;
    this.menu_card.visible = true;
    this.my_info_button.visible = true;
    this.rank_daily_button.visible = true;
    this.rank_weekly_button.visible = true;
    this.join_match_button.visible = !this.world && !this.is_matching;
    this.close_menu_button.visible = this.world !== null;
    this.game_select.Show();
    this.ReleaseControls();
    this.UpdateJoystickVisible();
    this.UpdatePlaceButton();
  }

  private CloseMenu(): void {
    this.is_menu_open = false;
    this.menu_card.visible = false;
    this.my_info_button.visible = false;
    this.rank_daily_button.visible = false;
    this.rank_weekly_button.visible = false;
    this.join_match_button.visible = false;
    this.close_menu_button.visible = false;
    this.game_select.Hide();
    this.UpdateJoystickVisible();
    this.UpdatePlaceButton();
  }

  // 정보 팝업을 띄운다. 이때 보이던 게임 선택 드롭다운은 팝업 위로 올라오지 않게 숨긴다.
  private ShowInfoPopup(title: string, content: string): void {
    if (this.game_select.visible) {
      this.game_select_hidden_by_popup = true;
      this.game_select.Hide();
    }
    this.info_popup.Show(title, content);
  }

  public Resize(width: number, _height: number): void {
    const center_x = width / 2;

    this.menu_card.position.set(center_x - MENU_CARD_WIDTH / 2, MENU_CARD_Y);

    this.status.anchor.set(0.5, 0);
    this.status.position.set(center_x, STATUS_Y);

    this.game_select.position.set(center_x - SELECT_WIDTH / 2, MENU_CARD_Y + 44);

    this.my_info_button.position.set(center_x - this.my_info_button.width / 2, MENU_CARD_Y + 136);
    this.join_match_button.position.set(center_x - this.join_match_button.width / 2, MENU_CARD_Y + 246);
    this.close_menu_button.position.set(center_x - this.close_menu_button.width / 2, MENU_CARD_Y + 246);
    this.place_button.position.set(center_x - PLACE_BUTTON_WIDTH / 2, PLACE_BUTTON_Y);
    this.cancel_match_button.position.set(center_x - this.cancel_match_button.width / 2, PLACE_BUTTON_Y);

    const rank_gap = 20;
    const rank_row_width = this.rank_daily_button.width + rank_gap + this.rank_weekly_button.width;
    const rank_row_x = center_x - rank_row_width / 2;
    this.rank_daily_button.position.set(rank_row_x, MENU_CARD_Y + 356);
    this.rank_weekly_button.position.set(rank_row_x + this.rank_daily_button.width + rank_gap, MENU_CARD_Y + 356);

    this.star_text.position.set(STAR_ROW_X, STAR_ROW_Y + STAR_ROW_HEIGHT / 2);
    this.ad_button.position.set(AD_BUTTON_X, STAR_ROW_Y);
  }

  public Destroy(): void {
    // 게임 씬으로 넘어간 뒤 늦게 도착한 로비 종료 이벤트가 파괴된 씬이나 전역 로딩 오버레이를 건드리지 않게 콜백을 끊는다.
    this.connection.Dispose();
    this.nickname_popup.DestroyPopup();
    this.game_select.DestroySelect();
    window.removeEventListener("wheel", this.wheel);
    window.removeEventListener("keydown", this.key_down);
    window.removeEventListener("keyup", this.key_up);
    window.removeEventListener("blur", this.window_blur);
    this.world?.Destroy();
    this.view.destroy({ children: true });
  }

  private async ConnectToLobby(): Promise<void> {
    if (this.connection.IsConnected()) return;

    this.SetStatus("접속 중...");
    this.enter_lobby_error_message = null;

    try {
      const result = await this.connection.Connect({
        // 수신 로그는 LobbyConnection 이 항상 남기므로(어떤 메시지든 누락 없이), 여기서는 화면 처리만 한다.
        onEnterLobbyResult: (envelope) => this.HandleEnterLobbyResult(envelope.payload),
        onNameResult: (envelope) => this.HandleNameResult(envelope.payload),
        onPlayInfo: (envelope) => this.ShowInfoPopup("내 정보", FormatPlayInfo(this.play_info_game, envelope.payload)),
        onRankDaily: (envelope) =>
          this.ShowInfoPopup(`일간 랭킹 (${envelope.payload.date})`, FormatRankList(envelope.payload.list, envelope.payload.my)),
        onRankWeekly: (envelope) =>
          this.ShowInfoPopup(
            `주간 랭킹 (${envelope.payload.term.start} ~ ${envelope.payload.term.end})`,
            FormatRankList(envelope.payload.list, envelope.payload.my)
          ),
        onAdViewComplete: (envelope) => this.HandleAdViewComplete(envelope.payload),
        onLobbyUsers: (envelope) => {
          this.world?.SetPlayerColor(envelope.payload.color);
          this.world?.SetRemoteUsers(envelope.payload.users);
        },
        onLobbyUserJoin: (envelope) => this.world?.UpsertRemoteUser(envelope.payload),
        onLobbyUserLeave: (envelope) => this.world?.RemoveRemoteUser(envelope.payload.id),
        onLobbyMoves: (envelope) => {
          for (const [id, x, z] of envelope.payload.moves) this.world?.MoveRemoteUser(id, x, z);
        },
        onJoinMatchResult: (envelope) => {
          // 성공(result:Y)은 문서상 이 type 으로 오는 것으로 되어 있지만, 실제로는 MATCH_FOUND 로 온다(비고 참고).
          // 실패만 여기서 처리하고, 연결은 유지되니 다시 '게임 참여'를 누를 수 있게 한다.
          if (envelope.payload.result === "N") {
            const message =
              (envelope.payload.error !== undefined && JOIN_MATCH_ERROR_MESSAGES[envelope.payload.error]) ||
              "게임 참여에 실패했습니다.";
            this.SetStatus(message);
            this.ShowJoinMatchButton();
          }
        },
        onMatchFound: (envelope) => void this.HandleMatchFound(envelope.payload),
        onRejoinGame: (envelope) => void this.HandleRejoinGame(envelope.payload),
        onNotice: (envelope) => this.options.notice_banner.Show(envelope.payload.message),
        onError: (envelope) => {
          // star 부족 — 매칭 대기를 닫고 안내한다. 로비 연결은 유지되니 광고를 보고 다시 참여할 수 있다.
          if (envelope.payload.code === "NOT_ENOUGH_STAR") {
            this.ShowJoinMatchButton();
            this.ShowNotEnoughStar();
            return;
          }
          this.SetStatus(`에러: ${envelope.payload.code}`);
          // 게임 채널이 다 찼을 때 — 연결은 유지되니 다시 '게임 참여'를 누를 수 있게 한다.
          if (envelope.payload.code === "NO_GAME_ROOM") {
            this.ShowJoinMatchButton();
          }
        },
        onLeave: (code) => {
          // ENTER_LOBBY 실패 응답 뒤 서버가 끊은 것 — 끊김 사유(중복 접속 등)를 그대로 알린다.
          if (this.enter_lobby_error_message !== null) {
            console.log(`${LOG_TAG} ENTER_LOBBY 실패 후 연결 종료 code=${code ?? "-"}`);
            this.ShowConnectionLost(this.enter_lobby_error_message);
            return;
          }
          // 매칭 성사로 서버가 스스로 끊는 정상 흐름(CONSENTED) — 에러 취급하지 않고 로딩을 보여준다.
          if (code === CloseCode.CONSENTED) {
            console.log(`${LOG_TAG} 로비 연결 종료(게임으로 이동) code=${code}`);
            this.options.loading_overlay.Show("게임 채널 접속 중...");
            return;
          }
          console.log(`${LOG_TAG} 연결 끊어짐 code=${code ?? "-"}`);
          this.ShowConnectionLost(`서버와의 연결이 끊어졌습니다. (code=${code ?? "-"})\n서버가 점검 중이거나 네트워크가 불안정할 수 있습니다.`);
        },
      });

      console.log(`${LOG_TAG} 접속 정보 ${JSON.stringify(result)}`);

      // 로비 소켓이 연결되면 버튼 없이 바로 ENTER_LOBBY 를 보낸다. 응답을 받기 전까지는 "접속 중"으로 표기한다.
      const payload = BuildEnterLobbyPayload();
      this.connection.SendEnterLobby(payload);
      console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "ENTER_LOBBY", payload })}`);
    } catch (error) {
      console.error(`${LOG_TAG} 접속 실패 ${error instanceof Error ? error.message : String(error)}`);
      this.ShowConnectionLost("서버에 접속할 수 없습니다.\n서버가 꺼져 있거나 네트워크가 불안정할 수 있습니다.");
    }
  }

  // 서버와 통신이 안 될 때 팝업으로 알린다. HTML 오버레이(별명 입력/게임 선택)는 캔버스 위에 떠 있어 팝업에
  // 가려지지 않으므로 먼저 모두 숨기고, 다른 팝업/로딩도 닫아 이 팝업 하나만 남긴다.
  private ShowConnectionLost(message: string): void {
    this.world?.SetRemoteUsers([]);
    this.options.loading_overlay.Hide();
    this.info_popup.Hide();
    this.nickname_popup.Hide();
    this.HideMainUi();
    this.status.visible = false;
    this.connection_lost_popup.Show(message);
  }

  // 팝업의 '로비로 접속' 버튼 — 팝업을 닫고 처음부터 다시 로비에 접속한다(성공하면 ENTER_LOBBY 부터 다시 진행).
  private ReconnectToLobby(): void {
    this.connection_lost_popup.Hide();
    this.status.visible = true;
    void this.ConnectToLobby();
  }

  // 로비 메인 UI(내정보/게임 참여/랭킹 버튼과 게임 선택)를 모두 숨긴다. 재접속 상태로 되돌릴 때 쓴다.
  private HideMainUi(): void {
    this.is_main_ui_shown = false;
    this.is_matching = false;
    this.ReleaseControls();
    this.CloseMenu();
    this.cancel_match_button.visible = false;
    this.star_text.visible = false;
    this.ad_button.visible = false;
  }

  // ENTER_LOBBY 응답 처리. 실패(result:N)면 메시지만 보여주고, 성공(result:Y)이면 name 이 공백일 때
  // 별명 입력 팝업을 띄우고, 아니면 바로 메인 UI 로 넘어간다.
  private HandleEnterLobbyResult(payload: EnterLobbyResultPayload): void {
    if (payload.result === "N") {
      const message =
        (payload.error !== undefined && ENTER_LOBBY_ERROR_MESSAGES[payload.error]) || "로비 접속에 실패했습니다.";
      this.SetStatus(message);
      this.enter_lobby_error_message = message;
      return;
    }

    this.my_userid = payload.userid ?? "";
    this.SetStar(payload.star ?? 0);

    if (payload.name !== "") {
      this.ShowMainUi();
      return;
    }

    this.SetStatus("");
    this.nickname_popup.Show({
      onSubmit: (name) => {
        this.connection.SendName({ name });
        console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "NAME", payload: { name } })}`);
      },
    });
  }

  private HandleNameResult(payload: NameResultPayload): void {
    if (payload.result === "Y") {
      this.nickname_popup.Hide();
      this.ShowMainUi();
      return;
    }

    const message = (payload.error !== undefined && NAME_ERROR_MESSAGES[payload.error]) || "별명 등록에 실패했습니다.";
    this.nickname_popup.SetError(message);
  }

  // 별명 등록까지 끝나면 접속/전달 버튼과 상태 텍스트를 지우고 필요한 버튼만 남긴다.
  private ShowMainUi(): void {
    // 문구만 비우고 숨기지는 않는다 — 이후 SetStatus(재접속 실패 등)로 띄운 문구가 보여야 한다.
    this.SetStatus("");
    this.is_main_ui_shown = true;
    this.star_text.visible = true;
    this.ad_button.visible = true;
    this.ad_button.SetEnabled(true);
    // 3D 를 못 쓰면 걸어갈 건물이 없으니 예전처럼 카드 메뉴를 바로 띄운다.
    if (!this.world) this.OpenMenu();
    this.UpdateJoystickVisible();
    this.UpdatePlaceButton();
  }

  private OnClickRankDaily(): void {
    const payload = { game: this.game_select.GetSelectedGame() };
    this.connection.SendRankDaily(payload);
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "RANK_DAILY", payload })}`);
  }

  private OnClickRankWeekly(): void {
    const payload = { game: this.game_select.GetSelectedGame() };
    this.connection.SendRankWeekly(payload);
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "RANK_WEEKLY", payload })}`);
  }

  private OnClickMyInfo(): void {
    const payload = { game: this.game_select.GetSelectedGame() };
    this.play_info_game = payload.game;
    this.connection.SendPlayInfo(payload);
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "PLAY_INFO", payload })}`);
  }

  private OnClickJoinMatch(): void {
    this.StartMatch(this.game_select.GetSelectedGame());
  }

  private StartMatch(game: GameId): void {
    // star 가 없으면 서버 응답(NOT_ENOUGH_STAR)을 기다리지 않고 바로 안내한다.
    if (this.star <= 0) {
      this.ShowNotEnoughStar();
      return;
    }

    this.match_game = game;
    const payload = { game, select: "Y" as const };
    this.connection.SendJoinMatch(payload);
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "JOIN_MATCH", payload })}`);
    // MATCH_FOUND 는 다른 유저가 매칭될 때까지 즉시 오지 않으므로, 그때까지 취소할 수 있게 한다.
    this.status.visible = true;
    this.SetStatus("상대를 찾는 중...");
    this.ShowCancelMatchButton();
  }

  private OnClickCancelMatch(): void {
    const payload = { game: this.match_game, select: "N" as const };
    this.connection.SendJoinMatch(payload);
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "JOIN_MATCH", payload })}`);
    this.SetStatus("매칭을 취소했습니다.");
    this.ShowJoinMatchButton();
  }

  private ShowJoinMatchButton(): void {
    this.is_matching = false;
    this.join_match_button.visible = !this.world && this.is_menu_open;
    this.join_match_button.SetEnabled(true);
    this.cancel_match_button.visible = false;
    this.UpdatePlaceButton();
  }

  private ShowCancelMatchButton(): void {
    this.is_matching = true;
    this.join_match_button.visible = false;
    this.cancel_match_button.visible = true;
    this.cancel_match_button.SetEnabled(true);
    this.UpdatePlaceButton();
  }

  // 매칭 성사 — seat_reservation 으로 게임 채널에 새로 접속한다.
  // 이 시점에 서버가 로비 연결을 스스로 끊으므로(CONSENTED), 그건 onLeave 에서 정상 흐름으로 처리한다.
  private async HandleMatchFound(payload: MatchFoundPayload): Promise<void> {
    // 매칭이 성사됐으니 더 이상 취소할 수 없다.
    this.cancel_match_button.visible = false;
    this.is_matching = false;
    this.is_main_ui_shown = false;
    this.place_button.visible = false;
    this.ReleaseControls();
    this.UpdateJoystickVisible();
    // 혼자 하는 게임(청기백기)은 opponent 가 오지 않는다.
    const opponent_text = payload.opponent ? ` 상대: ${payload.opponent.name || "(이름 없음)"} —` : "";
    this.options.loading_overlay.Show(`매칭 완료!${opponent_text} 게임 채널 접속 중...`);

    try {
      const game_room = await this.connection.ConsumeMatchSeat(payload.seat_reservation);
      console.log(`${LOG_TAG} 게임 채널 접속 완료 roomId=${game_room.roomId} sessionId=${game_room.sessionId}`);
      // 게임 종류는 방 이름(othello_1 등)이 가장 정확하다. 못 뽑으면 내가 로비에서 선택해 둔 게임을 쓴다.
      const game = ParseGameIdFromRoomName(payload.room_name) ?? this.match_game;
      this.options.onGameRoomReady({ room: game_room, game, my_userid: this.my_userid, is_rejoin: false });
    } catch (error) {
      console.error(`${LOG_TAG} 게임 채널 접속 실패 ${error instanceof Error ? error.message : String(error)}`);
      this.options.loading_overlay.Hide();

      if (this.connection.IsConnected()) {
        // 로비 연결이 아직 살아있으면 그대로 다시 '게임 참여'를 누를 수 있게 한다.
        this.SetStatus("게임 채널 접속 실패 (콘솔 확인) — 다시 시도해 주세요.");
        this.is_main_ui_shown = true;
        this.UpdateJoystickVisible();
        this.ShowJoinMatchButton();
        return;
      }

      // MATCH_FOUND 직후 서버가 로비 연결을 CONSENTED 로 끊어놨으므로 '게임 참여'를 다시 보내면 예외가 난다.
      // 로비부터 다시 접속해 ENTER_LOBBY 부터 진행한다(HandleRejoinGame 실패 처리와 같은 흐름).
      this.HideMainUi();
      this.status.visible = true;
      void this.ConnectToLobby();
    }
  }

  // 게임 도중 재접속 — ENTER_LOBBY 응답 직후 온다. 별명 팝업/메인 UI 를 띄울 필요 없이
  // 바로 끊기기 전의 게임방 세션으로 복귀한다.
  private async HandleRejoinGame(payload: RejoinGamePayload): Promise<void> {
    this.nickname_popup.Hide();
    this.options.loading_overlay.Show("게임 채널 재접속 중...");

    try {
      const game_room = await this.connection.ConsumeRejoinToken(payload);
      console.log(`${LOG_TAG} 게임 채널 재접속 완료 roomId=${game_room.roomId} sessionId=${game_room.sessionId}`);
      // 재접속은 로비에서 게임을 고른 적이 없으므로 방 이름으로만 게임을 알 수 있다(못 뽑으면 가위바위보로 본다).
      const game = ParseGameIdFromRoomName(payload.room_name) ?? GameId.RPS;
      this.options.onGameRoomReady({ room: game_room, game, my_userid: this.my_userid, is_rejoin: true });
    } catch (error) {
      console.error(`${LOG_TAG} 게임 채널 재접속 실패 ${error instanceof Error ? error.message : String(error)}`);
      this.options.loading_overlay.Hide();

      if (this.connection.IsConnected()) {
        // 로비 연결은 아직 살아있으니 에러만 알리고 원래 로비 화면을 그대로 둔다.
        this.SetStatus("게임 채널 재접속에 실패했습니다.");
        return;
      }

      // REJOIN_GAME 전송 직후 서버가 로비 연결도 스스로 끊어놓는 것으로 보인다(MATCH_FOUND 와 같은 패턴).
      // 게임 재접속까지 실패했다면 원래대로 로비에 접속된 상태로 돌아가야 하므로, 처음부터 다시 접속한다.
      this.HideMainUi();
      this.status.visible = true;
      void this.ConnectToLobby();
    }
  }

  // '광고 보기' — 버튼을 잠그고 광고를 재생한다. 끝까지 봤을 때만 AD_VIEW_COMPLETE 를 보내고, 잠금은 응답이 오면 푼다.
  private async OnClickWatchAd(): Promise<void> {
    this.ad_button.SetEnabled(false);
    const completed = await ShowRewardedAd();

    // 광고를 보는 동안 매칭 성사/연결 끊김으로 로비를 떠났으면 보낼 곳이 없다.
    if (!this.connection.IsConnected()) return;
    if (!completed) {
      this.SetStatus("광고를 끝까지 봐야 star 를 받을 수 있어요.");
      this.ad_button.SetEnabled(true);
      return;
    }
    this.connection.SendAdViewComplete();
  }

  private HandleAdViewComplete(payload: AdViewCompleteResultPayload): void {
    this.SetStar(payload.star);
    this.ad_button.SetEnabled(true);
    if (payload.result === "Y") {
      this.ShowStarGain(payload.star_add ?? 0);
      return;
    }
    this.SetStatus(AD_VIEW_ERROR_MESSAGE);
  }

  private ShowNotEnoughStar(): void {
    this.SetStatus("");
    this.ShowInfoPopup(STAR_SHORTAGE_TITLE, STAR_SHORTAGE_MESSAGE);
  }

  private SetStar(star: number): void {
    this.star = star;
    this.star_text.text = `★ ${star}`;
  }

  // star 옆에서 "+N" 이 위로 떠오르며 사라진다.
  private ShowStarGain(star_add: number): void {
    if (star_add <= 0) return;
    const effect = new Text({
      text: `+${star_add}`,
      style: {
        fill: CUTE_COLOR.red,
        fontSize: 34,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 7, join: "round" },
      },
    });
    effect.anchor.set(0, 0.5);
    const start_y = this.star_text.y;
    effect.position.set(this.star_text.x + this.star_text.width + 6, start_y);
    this.view.addChild(effect);

    let elapsed_ms = 0;
    const OnTick = (ticker: Ticker): void => {
      // 연출 중 씬이 파괴되면(매칭 성사 등) 같이 정리한다.
      if (effect.destroyed) {
        Ticker.shared.remove(OnTick);
        return;
      }
      elapsed_ms += ticker.deltaMS;
      const t = Math.min(elapsed_ms / STAR_GAIN_EFFECT_MS, 1);
      effect.y = start_y - STAR_GAIN_EFFECT_RISE * t;
      effect.alpha = 1 - t;
      if (t >= 1) {
        Ticker.shared.remove(OnTick);
        effect.destroy();
      }
    };
    Ticker.shared.add(OnTick);
  }

  private SetStatus(message: string): void {
    this.status.text = message;
  }
}
