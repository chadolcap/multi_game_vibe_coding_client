// 점핑 게임방 씬 — 씬이 만들어지면 바로 ENTER_ROOM 을 요청하고, 응답을 받으면
// 왼쪽에 상대 정보 / 오른쪽에 내 정보를 표시한 뒤 '게임 준비' 버튼을 활성화한다.
// 준비가 끝나면 MAP_SELECT(맵 번호, 준비 버튼 숨김) -> 2초 뒤 GAME_START -> 제한 시간(GAME_REMAIN_TIME) 동안 양쪽이 동시에 점프(MOVE_INFO)
// -> GAME_RESULT 순으로 진행한다. 화면 아래에는 상대(왼쪽)/나(오른쪽) 두 플레이 화면이 나란히 있고,
// 내 화면은 직접 조작, 상대 화면은 서버가 중계한 상대의 MOVE_INFO 대로 실제로 뛰는 모습을 보여준다.
// 방 입장/퇴장/재시작 흐름은 OthelloScene 과 같다.
import { Container, Graphics, Text } from "pixi.js";
import type { Room } from "@colyseus/sdk";
import type { Scene } from "../../scenes/Scene";
import { Button } from "../../ui/Button";
import { PlayerPanel } from "../../ui/PlayerPanel";
import { GameResultPopup, RESULT_SCREEN_DIM_ALPHA } from "../../ui/GameResultPopup";
import { GameStartBanner } from "../../ui/GameStartBanner";
import type { NoticeBanner } from "../../ui/NoticeBanner";
import { ConnectionLostPopup } from "../../ui/ConnectionLostPopup";
import {
  CUTE_COLOR,
  CUTE_FONT_FAMILY,
  CUTE_THEME,
  CreateCuteBackground,
  CreatePlayerCard,
  PLAYER_CARD_WIDTH,
  PLAYER_CARD_HEIGHT,
  PLAYER_CARD_PADDING_X,
} from "../../ui/CuteTheme";
import { DuckMascot } from "../../ui/DuckMascot";
import { Confetti } from "../../ui/Confetti";
import { SteppingConnection } from "./SteppingConnection";
import { SteppingView, STEPPING_VIEW_WIDTH, STEPPING_VIEW_HEIGHT } from "./SteppingView";
import { GetSteppingMap } from "./SteppingMap";
import type { EnterRoomPayload, OutUserPayload, OpponentJoinedPayload } from "../../common/types";
import type {
  SteppingGameResultPayload,
  SteppingGameStatusPayload,
  SteppingMapSelectPayload,
  SteppingMoveInfoPayload,
  SteppingMoveInfoResultPayload,
  SteppingRemainTimePayload,
} from "./types";

const LOG_TAG = "[Game]";

// GAME_START 연출(효과 배너)을 보여주는 시간. 게임 시간이 짧아 잠깐만 보여주고, 그동안에도 점프는 할 수 있다.
const GAME_START_BANNER_DURATION_MS = 900;

// 재접속 안내("별명님 재접속했습니다.")를 보여주는 시간.
const REJOIN_NOTICE_MS = 5000;
// 총 게임 시간. 맵 연출 중과 GAME_START 직후 첫 GAME_REMAIN_TIME 이 오기 전까지 이 값을 보여준다.
// 서버 steppingConstants.ts 의 STEPPING_GAME_TIME_SEC 와 맞춘다(시트는 20초, 서버가 60초로 변경 — 2026-10-14 확인).
const GAME_TIME_SEC = 60;
// 남은 시간이 이 값 이하면 빨간색으로 강조한다.
const TIME_WARNING_SEC = 5;

// 두 사용자 정보 카드 사이 간격(가운데에 VS 표기).
const CARD_GAP = 60;
// 화면 세로 배치(720x1280 기준). 타이틀 → 사용자 정보 카드 → 남은 시간 → 플레이 화면 두 개 → 안내 문구 → 버튼 순.
const PANEL_Y = 118;
const VIEW_Y = 474;
// 남은 시간 표시 — 사용자 정보 카드 아래쪽 끝과 플레이 화면 이름표("상대"/"나", 화면 위로 22px 튀어나옴) 위쪽 끝의 한가운데.
const TIMER_CENTER_Y = (PANEL_Y - 20 + PLAYER_CARD_HEIGHT + VIEW_Y - 22) / 2;
const TIMER_BADGE_WIDTH = 250;
const TIMER_BADGE_HEIGHT = 44;
const VIEW_GAP = 16;
const BUTTON_Y = 1186;

export interface SteppingSceneOptions {
  room: Room;
  // player1/player2 중 내 쪽을 구분하기 위한 값.
  my_userid: string;
  // REJOIN_GAME 으로 들어온 경우 true — 이미 판이 진행 중이므로 '게임 준비' 버튼을 보여주지 않는다.
  is_rejoin: boolean;
  notice_banner: NoticeBanner;
  // 로비로 돌아갈 때 새 로비 씬을 만들기 위한 콜백.
  onExitToLobby: () => void;
}

export class SteppingScene implements Scene {
  readonly view = new Container();

  private readonly status: Text;
  private readonly round_status: Text;
  private readonly rejoin_notice: Text;
  private readonly timer_text: Text;
  // 남은 시간 배지(둥근 바탕 + timer_text). 남은 시간이 없을 때(게임 전/후)는 숨긴다.
  private readonly timer_badge = new Container();
  private readonly title_text: Text;
  private readonly vs_text: Text;
  private readonly opponent_card = CreatePlayerCard("상대", CUTE_COLOR.shirt_dark);
  private readonly my_card = CreatePlayerCard("나", CUTE_COLOR.orange);
  private readonly opponent_panel = new PlayerPanel(CUTE_THEME);
  private readonly my_panel = new PlayerPanel(CUTE_THEME);
  // 상대(왼쪽)/나(오른쪽) 플레이 화면 — 사용자 정보 카드와 같은 쪽에 둔다.
  private readonly opponent_view: SteppingView;
  private readonly my_view: SteppingView;
  // 최종 결과(GAME_RESULT) 때 두 화면 가운데에 나타나 승자 별명을 쓴 플랜카드를 드는 오리 캐릭터.
  private readonly duck = new DuckMascot();
  private readonly confetti = new Confetti();
  private readonly ready_button: Button;
  private readonly game_start_banner = new GameStartBanner(CUTE_THEME);
  private readonly result_popup: GameResultPopup;
  private readonly back_to_lobby_button: Button;
  private readonly connection_lost_popup: ConnectionLostPopup;
  private readonly connection: SteppingConnection;
  private readonly options: SteppingSceneOptions;
  // ENTER_ROOM 때 정해지는 상대 userid — MOVE_INFO/GAME_STATUS 를 누구 화면에 그릴지 구분한다.
  private opponent_userid = "";
  // GAME_RESULT 는 userid 만 주므로, 최종 결과 플랜카드에 쓸 별명을 ENTER_ROOM 때 기억해 둔다.
  private my_name = "";
  private opponent_name = "";
  // 두 화면의 진행 칸 수(안내 문구용).
  private my_count = 0;
  private opponent_count = 0;
  // '재시작'을 눌러서 응답을 기다리는 중인지 — 이 상태에서 OUT_USER 를 받으면 새 상대를 기다리는 상태로 넘어간다.
  private has_requested_replay = false;
  // 결과 화면에서 내가 재시작/나가기를 고르기 전에 상대가 먼저 나간 경우.
  private opponent_left_at_result = false;
  // '나가기'를 눌러서 스스로 끊는 중인지 — 아니면 onLeave 는 예기치 않은 오류로 취급한다.
  private exit_requested = false;
  // RETURN_TO_LOBBY 와 onLeave(CONSENTED) 가 같은 상황에서 둘 다 올 수 있어, 로비 전환은 한 번만 한다.
  private returned_to_lobby = false;
  private banner_timer: ReturnType<typeof setTimeout> | null = null;
  // 재접속 안내를 5초 뒤에 지우는 타이머.
  private rejoin_notice_timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SteppingSceneOptions) {
    this.options = options;
    this.connection = new SteppingConnection(options.room);

    this.status = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.red,
        fontSize: 19,
        fontFamily: CUTE_FONT_FAMILY,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 640,
        stroke: { color: 0xffffff, width: 5, join: "round" },
      },
    });
    this.status.anchor.set(0.5, 0);

    this.round_status = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.brown,
        fontSize: 18,
        fontFamily: CUTE_FONT_FAMILY,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 640,
        stroke: { color: 0xffffff, width: 4, join: "round" },
      },
    });
    this.round_status.anchor.set(0.5, 0);

    this.rejoin_notice = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.shirt_dark,
        fontSize: 15,
        fontFamily: CUTE_FONT_FAMILY,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 640,
        stroke: { color: 0xffffff, width: 4, join: "round" },
      },
    });
    this.rejoin_notice.anchor.set(0.5, 0);

    // GAME_REMAIN_TIME — 사용자 정보 카드와 두 플레이 화면 사이 가운데에 둥근 배지로 표기.
    this.timer_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 28,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 6, join: "round" },
      },
    });
    this.timer_text.anchor.set(0.5);
    const timer_background = new Graphics()
      .roundRect(-TIMER_BADGE_WIDTH / 2, -TIMER_BADGE_HEIGHT / 2 + 4, TIMER_BADGE_WIDTH, TIMER_BADGE_HEIGHT, TIMER_BADGE_HEIGHT / 2)
      .fill({ color: 0x000000, alpha: 0.1 })
      .roundRect(-TIMER_BADGE_WIDTH / 2, -TIMER_BADGE_HEIGHT / 2, TIMER_BADGE_WIDTH, TIMER_BADGE_HEIGHT, TIMER_BADGE_HEIGHT / 2)
      .fill(CUTE_COLOR.cream)
      .stroke({ color: CUTE_COLOR.orange, width: 4 });
    this.timer_badge.addChild(timer_background, this.timer_text);
    this.timer_badge.visible = false;

    this.title_text = new Text({
      text: "점핑!",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 44,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 9, join: "round" },
        dropShadow: { color: CUTE_COLOR.orange_dark, alpha: 0.5, distance: 4, angle: Math.PI / 2, blur: 0 },
      },
    });
    this.title_text.anchor.set(0.5, 0);

    this.vs_text = new Text({
      text: "VS",
      style: {
        fill: CUTE_COLOR.red,
        fontSize: 48,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 8, join: "round" },
      },
    });
    this.vs_text.anchor.set(0.5);

    this.opponent_view = new SteppingView({ is_mine: false, tag: "상대", tag_color: CUTE_COLOR.shirt_dark });
    this.my_view = new SteppingView({
      is_mine: true,
      tag: "나",
      tag_color: CUTE_COLOR.orange,
      onJump: (move) => this.OnJump(move),
    });

    this.duck.visible = false;

    this.ready_button = new Button({
      label: "게임 준비",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.OnClickReady(),
    });
    this.ready_button.SetEnabled(false);
    this.ready_button.visible = false;

    this.result_popup = new GameResultPopup({
      onReplay: () => this.OnClickReplay(),
      onExit: () => this.OnClickExit(),
      theme: CUTE_THEME,
      // 두 화면 가운데 오리(승자 플랜카드)가 보이도록 작게 만들어 오리 발 아래에 띄우고, 뒤 게임 화면은 옅은 검정으로 덮어 결과 화면과 분리한다.
      layout: { panel_width: 520, panel_height: 290, panel_y: 940, button_height: 56, dim_alpha: RESULT_SCREEN_DIM_ALPHA },
    });

    this.back_to_lobby_button = new Button({
      label: "로비로 돌아가기",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.GoToLobbyOnce(),
    });
    this.back_to_lobby_button.visible = false;

    this.connection_lost_popup = new ConnectionLostPopup({
      button_label: "로비로 접속",
      onConfirm: () => this.GoToLobbyOnce(),
    });

    this.view.addChild(
      CreateCuteBackground(),
      this.title_text,
      this.opponent_card,
      this.my_card,
      this.vs_text,
      this.opponent_panel,
      this.my_panel,
      this.timer_badge,
      this.opponent_view,
      this.my_view,
      this.status,
      this.round_status,
      this.rejoin_notice,
      this.ready_button,
      this.result_popup,
      // 결과 팝업의 옅은 덮개보다 위에 둬서 오리가 흐려지지 않게 한다.
      this.duck,
      this.back_to_lobby_button,
      this.confetti,
      this.game_start_banner,
      this.connection_lost_popup
    );
    this.ResetPlayState(null);

    this.connection.Listen({
      onEnterRoom: (envelope) => this.HandleEnterRoom(envelope.payload),
      onOutUser: (envelope) => this.HandleOutUser(envelope.payload),
      onMapSelect: (envelope) => this.HandleMapSelect(envelope.payload),
      onGameStart: () => this.HandleGameStart(),
      onGameRemainTime: (envelope) => this.HandleGameRemainTime(envelope.payload),
      onMoveInfo: (envelope) => this.HandleMoveInfo(envelope.payload),
      onGameStatus: (envelope) => this.HandleGameStatus(envelope.payload),
      onGameResult: (envelope) => this.HandleGameResult(envelope.payload),
      onReturnToLobby: () => this.GoToLobbyOnce(),
      onOpponentJoined: (envelope) => this.HandleOpponentJoined(envelope.payload),
      onNotice: (envelope) => this.options.notice_banner.Show(envelope.payload.message),
      onLeave: (code) => this.HandleLeave(code),
    });

    this.connection.SendEnterRoom();
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "ENTER_ROOM" })}`);
  }

  public Resize(width: number, _height: number): void {
    const center_x = width / 2;
    const views_left = center_x - STEPPING_VIEW_WIDTH - VIEW_GAP / 2;

    this.title_text.position.set(center_x, 10);
    this.opponent_card.position.set(center_x - CARD_GAP / 2 - PLAYER_CARD_WIDTH, PANEL_Y - 20);
    this.my_card.position.set(center_x + CARD_GAP / 2, PANEL_Y - 20);
    this.opponent_panel.position.set(this.opponent_card.x + PLAYER_CARD_PADDING_X, PANEL_Y);
    this.my_panel.position.set(this.my_card.x + PLAYER_CARD_PADDING_X, PANEL_Y);
    this.vs_text.position.set(center_x, PANEL_Y + 80);
    this.timer_badge.position.set(center_x, TIMER_CENTER_Y);
    this.opponent_view.position.set(views_left, VIEW_Y);
    this.my_view.position.set(center_x + VIEW_GAP / 2, VIEW_Y);
    // 오리는 발 가운데가 기준점이라, 몸통이 두 화면 한가운데에 오도록 발을 가운데보다 조금 아래에 둔다.
    this.duck.position.set(center_x, VIEW_Y + STEPPING_VIEW_HEIGHT / 2 + 135);
    this.status.position.set(center_x, VIEW_Y + STEPPING_VIEW_HEIGHT + 10);
    this.round_status.position.set(center_x, VIEW_Y + STEPPING_VIEW_HEIGHT + 38);
    this.rejoin_notice.position.set(center_x, VIEW_Y + STEPPING_VIEW_HEIGHT + 64);
    this.ready_button.position.set(center_x - this.ready_button.width / 2, BUTTON_Y);
    this.back_to_lobby_button.position.set(center_x - this.back_to_lobby_button.width / 2, BUTTON_Y);
  }

  public Destroy(): void {
    // '로비로 돌아가기'는 방을 나가지 않고 화면만 바꾸므로, 이후 오는 게임 채널 메시지가 파괴된 씬을 건드리지 않게 콜백을 끊는다.
    this.connection.Dispose();
    if (this.banner_timer) clearTimeout(this.banner_timer);
    if (this.rejoin_notice_timer) clearTimeout(this.rejoin_notice_timer);
    this.view.destroy({ children: true });
  }

  // player1/player2 중 어느 쪽이 나인지 표시가 없어 userid 로 직접 구분한다.
  private HandleEnterRoom(payload: EnterRoomPayload): void {
    const is_player1_me = payload.player1.userid === this.options.my_userid;
    const me = is_player1_me ? payload.player1 : payload.player2;
    const opponent = is_player1_me ? payload.player2 : payload.player1;

    this.opponent_panel.SetInfo(opponent);
    this.my_panel.SetInfo(me);
    this.opponent_userid = opponent.userid;
    this.my_name = me.name;
    this.opponent_name = opponent.name;
    this.my_view.SetName(me.name);
    this.opponent_view.SetName(opponent.name);
    // 재시작 후 상대를 기다리던 중이었다면 떠 있던 '로비로 돌아가기' 버튼을 치운다 — 새 방/상대로 진행된다.
    this.back_to_lobby_button.visible = false;

    if (this.options.is_rejoin) {
      // 게임 도중 재접속 — 서버가 ENTER_ROOM 응답과 함께 GAME_STATUS 를 보내 진행 상태를 되돌려 준다.
      if (this.status.text === "") {
        this.status.text = "대기중";
      }
      this.ShowRejoinNotice(me.name || me.userid);
      return;
    }

    this.ready_button.visible = true;
    this.ready_button.SetEnabled(true);
    this.status.text = "준비가 되면 '게임 준비'를 눌러 주세요.";
  }

  private HandleOutUser(payload: OutUserPayload): void {
    console.log(`${LOG_TAG} 퇴장 알림 userid=${payload.userid}`);

    // '재시작'을 신청해놓고 응답을 기다리던 중이었다면, 새 상대를 기다리는 상태로 넘어간 것이다.
    if (this.has_requested_replay) {
      this.HandleWaitingForOpponent();
      return;
    }

    // 결과 화면(재시작/나가기 선택 대기 중)에서 상대가 먼저 나간 경우 — 결과 팝업은 그대로 둔다.
    if (this.result_popup.visible) {
      this.opponent_left_at_result = true;
      this.status.text = "상대방이 먼저 나갔습니다. 재시작하면 새 상대를 기다립니다.";
      return;
    }

    this.status.text = "상대방이 나갔습니다.";
    this.StopPlayUi();
    this.result_popup.Hide();
    this.back_to_lobby_button.visible = true;
  }

  // 재시작을 신청했는데 상대가 먼저 나가서, 새 상대가 이 방에 들어올 때까지 기다리는 상태를 보여준다.
  private HandleWaitingForOpponent(): void {
    this.status.text = "새 상대를 기다리는 중...";
    this.opponent_panel.SetInfo({ userid: "-", name: "-", avatar: "-", win_per: 0 });
    this.opponent_view.SetName("");
    this.opponent_userid = "";
    this.ready_button.visible = false;
    this.StopPlayUi();
    this.result_popup.Hide();
    this.back_to_lobby_button.visible = true;
  }

  // 기다리던 새 상대가 입장했다. 서버가 곧 뒤이어 보내는 ENTER_ROOM 응답 기준으로 다시 그린다.
  private HandleOpponentJoined(_payload: OpponentJoinedPayload): void {
    this.status.text = "상대를 찾았습니다! 입장 중...";
    this.connection.SendEnterRoom();
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "ENTER_ROOM" })}`);
  }

  private OnClickReady(): void {
    this.connection.SendReady({ ready: "Y" });
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "READY", payload: { ready: "Y" } })}`);
    this.ready_button.SetEnabled(false);
    this.status.text = "상대의 준비를 기다리는 중...";
  }

  // 양쪽 READY(또는 둘 다 재시작) 후 맵이 정해졌다 — 준비 버튼을 없애고 두 화면에 같은 맵을 깐다.
  // 2초 뒤 GAME_START 가 오면 점프할 수 있다.
  private HandleMapSelect(payload: SteppingMapSelectPayload): void {
    this.has_requested_replay = false;
    this.opponent_left_at_result = false;
    this.ready_button.visible = false;
    this.back_to_lobby_button.visible = false;
    this.result_popup.Hide();
    this.HideRejoinNotice();

    this.ResetPlayState(payload.map);
    // 맵 연출(2초) 동안에도 남은 시간 자리를 비워 두지 않고 총 시간을 미리 보여준다.
    this.SetTimer(GAME_TIME_SEC);
    this.my_view.SetMessage(`맵 ${payload.map}`);
    this.opponent_view.SetMessage(`맵 ${payload.map}`);
    this.status.text = "곧 시작합니다! 꾹 눌렀다가 떼면 점프해요.";
  }

  // 점프 시작 — 짧게 GAME START 효과를 보여주고 바로 조작할 수 있게 한다.
  private HandleGameStart(): void {
    this.my_view.SetMessage("");
    this.opponent_view.SetMessage("");
    this.my_view.SetPlayable(true);
    this.SetTimer(GAME_TIME_SEC);
    this.status.text = "다음 블록까지 거리를 맞춰 점프하세요!";

    if (this.banner_timer) clearTimeout(this.banner_timer);
    this.game_start_banner.Show();
    this.banner_timer = setTimeout(() => this.HideGameStartBanner(), GAME_START_BANNER_DURATION_MS);
  }

  private HandleGameRemainTime(payload: SteppingRemainTimePayload): void {
    this.SetTimer(payload.count);
    // 0초 — 서버가 곧 GAME_RESULT 를 보낸다. 더 뛰어도 서버가 받지 않으므로 조작을 막는다.
    if (payload.count <= 0) {
      this.my_view.SetPlayable(false);
      this.status.text = "시간 종료!";
    }
  }

  // 내 화면에서 점프를 마쳤다(손을 뗀 순간 착지 여부가 정해진다) — 서버에 그대로 보낸다.
  private OnJump(move: SteppingMoveInfoPayload): void {
    this.connection.SendMoveInfo(move);
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "MOVE_INFO", payload: move })}`);
    if (move.save === "yes") {
      this.my_count = move.count;
      this.UpdateProgress();
    }
  }

  // 서버가 중계한 점프 결과 — 양쪽 모두에게 온다. 상대 것이면 상대 화면에서 실제로 뛰게 하고,
  // 내 것이면 이미 내 화면에서 뛰었으므로 서버 기준 라이프만 맞춘다.
  private HandleMoveInfo(payload: SteppingMoveInfoResultPayload): void {
    if (payload.userid === this.options.my_userid) {
      this.my_view.SetLife(payload.life);
      if (payload.save === "no" && payload.life === 0) this.status.text = "라이프를 다 썼어요! 한 번 더 떨어지면 탈락!";
      return;
    }
    if (this.opponent_userid !== "" && payload.userid !== this.opponent_userid) return;

    this.opponent_view.PlayRemoteMove({ count: payload.count, location: payload.location, save: payload.save, life: payload.life });
    if (payload.save === "yes") {
      this.opponent_count = payload.count;
      this.UpdateProgress();
    }
  }

  // 게임 중 재접속 — 서버가 재접속 당사자에게만 보내는 현재 상태로 맵과 두 유저의 칸/라이프를 복원한다.
  private HandleGameStatus(payload: SteppingGameStatusPayload): void {
    this.ready_button.visible = false;
    this.ResetPlayState(payload.map);
    // 재접속 안내("별명님 재접속했습니다.")는 여기서 지우지 않는다 — 5초 타이머가 지운다.

    for (const player of [payload.player1, payload.player2]) {
      const is_me = player.userid === this.options.my_userid;
      (is_me ? this.my_view : this.opponent_view).SetPlayerState(player.count, player.life, player.location);
      if (is_me) this.my_count = player.count;
      else this.opponent_count = player.count;
    }
    this.UpdateProgress();

    // count(남은 초)가 없으면 아직 GAME_START 전(맵 연출 2초) — GAME_START 가 오면 조작이 켜진다.
    if (payload.count !== undefined) {
      this.SetTimer(payload.count);
      this.my_view.SetPlayable(payload.count > 0);
      this.status.text = "이어서 점프하세요!";
    } else {
      this.status.text = "곧 시작합니다!";
    }
  }

  // 최종 결과 — win_count 는 이동한 칸 수, score 는 남은 라이프×10 + 칸 수×5. draw:"Y" 면 무승부.
  private HandleGameResult(payload: SteppingGameResultPayload): void {
    const am_i_winner = payload.winner.userid === this.options.my_userid;
    const me = am_i_winner ? payload.winner : payload.loser;
    const opponent = am_i_winner ? payload.loser : payload.winner;
    const is_draw = payload.draw === "Y";

    // ENTER_ROOM 때 보여준 사용자 정보 뷰의 win_per 를 최신 값으로 갱신한다.
    this.my_panel.UpdateWinPer(me.win_per);
    this.opponent_panel.UpdateWinPer(opponent.win_per);

    this.StopPlayUi();
    this.ShowFinalDuck(am_i_winner, is_draw, payload.winner.userid);
    // 승패는 오리 머리 위 문구로 이미 보여주므로 팝업에는 칸 수/라이프/점수만 쓴다.
    this.result_popup.Show(
      `나: ${me.win_count}칸 · 라이프 ${me.life} · ${me.score}점\n` +
        `상대: ${opponent.win_count}칸 · 라이프 ${opponent.life} · ${opponent.score}점`
    );
  }

  private OnClickReplay(): void {
    this.has_requested_replay = true;
    this.connection.SendReplay({ replay: "Y" });
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "GAME_RESULT", payload: { replay: "Y" } })}`);

    // 재시작을 고르면 이전 판 화면을 바로 비운다(새 판은 MAP_SELECT 에서 새 맵으로 시작한다).
    this.ResetPlayState(null);

    // 상대가 이미 나간 상태였다면 그 상대의 응답을 다시 기다릴 필요가 없으니 바로 대기 상태로 넘어간다.
    if (this.opponent_left_at_result) {
      this.HandleWaitingForOpponent();
      return;
    }

    this.status.text = "재시작 대기 중...";
  }

  private OnClickExit(): void {
    this.exit_requested = true;
    this.connection.SendReplay({ replay: "N" });
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "GAME_RESULT", payload: { replay: "N" } })}`);
    this.status.text = "나가는 중...";
  }

  // 재접속 안내 — "별명님 재접속했습니다." 를 화면 아래에 띄우고 REJOIN_NOTICE_MS 뒤에 지운다.
  private ShowRejoinNotice(name: string): void {
    this.HideRejoinNotice();
    this.rejoin_notice.text = `${name}님 재접속했습니다.`;
    this.rejoin_notice_timer = setTimeout(() => this.HideRejoinNotice(), REJOIN_NOTICE_MS);
  }

  private HideRejoinNotice(): void {
    if (this.rejoin_notice_timer) {
      clearTimeout(this.rejoin_notice_timer);
      this.rejoin_notice_timer = null;
    }
    this.rejoin_notice.text = "";
  }

  // 정상 종료는 내가 나가기를 눌렀거나(exit_requested) RETURN_TO_LOBBY 를 받은 경우(returned_to_lobby)뿐이다.
  private HandleLeave(code?: number): void {
    if (this.returned_to_lobby) return;

    if (this.exit_requested) {
      this.GoToLobbyOnce();
      return;
    }

    this.status.text = `게임 채널 연결이 끊어졌습니다 (code=${code ?? "-"}). 서버 쪽 문제일 수 있습니다.`;
    this.connection_lost_popup.Show(
      `게임 서버와의 연결이 끊어졌습니다. (code=${code ?? "-"})
서버가 꺼졌거나 네트워크가 불안정할 수 있습니다.
로비로 다시 접속해 주세요.`
    );
    this.ready_button.visible = false;
    this.StopPlayUi();
    this.result_popup.Hide();
    this.back_to_lobby_button.visible = true;
  }

  // RETURN_TO_LOBBY, onLeave(나가기 요청 후), '로비로 돌아가기'/'로비로 접속' 버튼 중 무엇이 먼저 오든 한 번만 전환한다.
  private GoToLobbyOnce(): void {
    if (this.returned_to_lobby) return;
    this.returned_to_lobby = true;
    this.options.onExitToLobby();
  }

  // 두 화면 가운데에 오리를 띄워 승자 별명을 쓴 플랜카드를 들게 하고 색종이를 뿌린다.
  private ShowFinalDuck(am_i_winner: boolean, is_draw: boolean, winner_userid: string): void {
    this.duck.visible = true;
    if (is_draw) {
      this.duck.ShowFinalResult(`${this.my_name || "나"} & ${this.opponent_name || "상대"}`, "무승부", CUTE_COLOR.brown, "DRAW");
    } else {
      const winner_name = (am_i_winner ? this.my_name : this.opponent_name) || winner_userid;
      // 점핑은 한 판으로 끝나므로 "최종" 없이 승리/패배만 쓴다.
      this.duck.ShowFinalResult(
        winner_name,
        am_i_winner ? "승리!" : "패배",
        am_i_winner ? CUTE_COLOR.red : CUTE_COLOR.shirt_dark
      );
    }
    this.confetti.Play();
  }

  private HideFinalDuck(): void {
    this.duck.Reset();
    this.duck.visible = false;
    this.confetti.Stop();
  }

  // 새 판 상태로 되돌린다. map 이 있으면 두 화면에 그 맵을 깔고, null 이면 맵 없이 비운다.
  private ResetPlayState(map_no: number | null): void {
    this.HideFinalDuck();
    const map = map_no === null ? null : GetSteppingMap(map_no);
    for (const view of [this.my_view, this.opponent_view]) {
      view.SetMap(map);
      view.SetPlayable(false);
      view.SetMessage(map ? "" : "준비 중");
    }
    this.my_count = 0;
    this.opponent_count = 0;
    this.ClearTimer();
    this.round_status.text = "";
    this.UpdateProgress();
  }

  // 판 진행 중에만 의미 있는 UI(조작/남은 시간/연출 배너)를 모두 끈다 — 화면의 블록/캐릭터 위치는 그대로 둔다.
  private StopPlayUi(): void {
    this.my_view.SetPlayable(false);
    this.ClearTimer();
    this.HideGameStartBanner();
    this.HideFinalDuck();
  }

  private HideGameStartBanner(): void {
    if (this.banner_timer) {
      clearTimeout(this.banner_timer);
      this.banner_timer = null;
    }
    this.game_start_banner.Hide();
  }

  private SetTimer(count: number): void {
    this.timer_text.text = `남은 시간 ${Math.max(0, count)}초`;
    this.timer_text.style.fill = count <= TIME_WARNING_SEC ? CUTE_COLOR.red : CUTE_COLOR.orange;
    this.timer_badge.visible = true;
  }

  private ClearTimer(): void {
    this.timer_text.text = "";
    this.timer_badge.visible = false;
  }

  private UpdateProgress(): void {
    this.round_status.text =
      this.my_count === 0 && this.opponent_count === 0 ? "" : `나: ${this.my_count}칸  상대: ${this.opponent_count}칸`;
  }
}
