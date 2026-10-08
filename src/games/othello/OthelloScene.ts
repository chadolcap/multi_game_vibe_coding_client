// 오델로 게임방 씬 — 씬이 만들어지면 바로 ENTER_ROOM 을 요청하고, 응답을 받으면
// 왼쪽에 상대 정보 / 오른쪽에 내 정보를 표시한 뒤 '게임 준비' 버튼을 활성화한다.
// 준비가 끝나면 GAME_START -> 돌 색 선택(DOLL_SELECT) -> (TURN_START -> 착수(SELECT_GAME)) 반복 -> GAME_RESULT 순으로 진행한다.
// 방 입장/퇴장/재시작 흐름은 RpsScene 과 같고, 돌 색 선택과 턴 진행만 오델로 전용이다.
import { Container, Text } from "pixi.js";
import { CloseCode, type Room } from "@colyseus/sdk";
import type { Scene } from "../../scenes/Scene";
import { Button } from "../../ui/Button";
import { PlayerPanel, AVATAR_SIZE } from "../../ui/PlayerPanel";
import { GameResultPopup } from "../../ui/GameResultPopup";
import { GameStartBanner } from "../../ui/GameStartBanner";
import type { NoticeBanner } from "../../ui/NoticeBanner";
import { OthelloBoard, OTHELLO_BOARD_PIXEL_SIZE } from "./OthelloBoard";
import { OthelloColorPanel, OTHELLO_COLOR_PANEL_WIDTH } from "./OthelloColorPanel";
import { OthelloConnection } from "./OthelloConnection";
import type { EnterRoomPayload, OutUserPayload, OpponentJoinedPayload } from "../../common/types";
import {
  OthelloColor,
  type OthelloDollSelectResultPayload,
  type OthelloGameResultPayload,
  type OthelloGameStatusPayload,
  type OthelloPoint,
  type OthelloRemainTimePayload,
  type OthelloSelectGameResultPayload,
  type OthelloTurnStartPayload,
} from "./types";

const LOG_TAG = "[Game]";

// GAME_START 연출(효과 배너)을 보여주는 시간. 서버는 이 뒤에 돌 색 선택(DOLL_SELECT_REMAIN_TIME)을 시작한다.
const GAME_START_BANNER_DURATION_MS = 5000;

// 내 차례가 아닐 때 사용자 패널을 흐리게 보여주는 투명도.
const WAITING_PANEL_ALPHA = 0.55;

// 오토모드에서 내 차례가 되고 나서 자동으로 착수하기까지의 지연. 곧바로 두면 상대 착수 직후 화면이 확 바뀌어
// 어색하고, 서버가 TURN_START 직후 보내는 TURN_REMAIN_TIME 보다 먼저 응답하게 되므로 잠깐 둔다.
const AUTO_PLAY_DELAY_MS = 1000;

export interface OthelloSceneOptions {
  room: Room;
  // player1/player2 중 내 쪽을 구분하기 위한 값 (ENTER_ROOM 은 name/avatar/win_per 까지 다 담아 오므로 이것만 있으면 된다).
  my_userid: string;
  // REJOIN_GAME 으로 들어온 경우 true — 이미 판이 진행 중이므로 ENTER_ROOM 응답을 받아도
  // '게임 준비' 버튼을 보여주지 않고 "대기중"만 표시한다.
  is_rejoin: boolean;
  notice_banner: NoticeBanner;
  // 로비로 돌아갈 때 새 로비 씬을 만들기 위한 콜백 (새 로비 씬은 뜨자마자 스스로 접속을 시도한다).
  onExitToLobby: () => void;
}

export class OthelloScene implements Scene {
  readonly view = new Container();

  private readonly status: Text;
  private readonly round_status: Text;
  private readonly rejoin_notice: Text;
  private readonly score_text: Text;
  private readonly countdown_text: Text;
  private readonly opponent_panel = new PlayerPanel();
  private readonly my_panel = new PlayerPanel();
  private readonly board: OthelloBoard;
  private readonly color_panel: OthelloColorPanel;
  private readonly ready_button: Button;
  private readonly auto_mode_button: Button;
  private readonly game_start_banner = new GameStartBanner();
  private readonly result_popup: GameResultPopup;
  private readonly back_to_lobby_button: Button;
  private readonly connection: OthelloConnection;
  private readonly options: OthelloSceneOptions;
  // DOLL_SELECT 결과로 정해지는 내 돌 색. 판이 시작될 때마다 비워진다. 재접속(REJOIN_GAME)한 경우에는
  // 서버가 이미 끝난 돌 색 선택을 다시 알려주지 않아 이 판 내내 null 일 수 있다.
  private my_color: OthelloColor | null = null;
  // 이번 판에서 내가 돌 색을 이미 눌렀는지 — 눌렀다면 선택 패널을 다시 활성화하지 않는다.
  private color_requested = false;
  // 지금 내가 돌을 놓을 차례인지(TURN_START.turn === 내 userid). 착수를 보내거나 결과를 받으면 false.
  private is_my_turn = false;
  // 오토모드 — 켜져 있으면 내 차례마다 놓을 수 있는 자리(can) 중 하나를 클라이언트가 골라 SELECT_GAME 으로 보낸다.
  // 판이 바뀌어도(재시작/새 상대) 유지된다.
  private is_auto_mode = false;
  // 이번 내 차례에 놓을 수 있는 자리(TURN_START.can). 오토모드를 차례 도중에 켜도 바로 둘 수 있게 들고 있는다.
  private my_turn_can: OthelloPoint[] = [];
  // 오토모드 자동 착수 타이머. 착수/결과/판 종료 등으로 차례가 끝나면 취소한다.
  private auto_play_timer: ReturnType<typeof setTimeout> | null = null;
  // 바로 직전 TURN_START 의 turn. 같은 유저가 연속으로 오면 상대가 놓을 곳이 없어 패스한 것이다.
  private last_turn_userid: string | null = null;
  // '재시작'을 눌러서 응답을 기다리는 중인지 — 이 상태에서 OUT_USER 를 받으면(상대가 나가기를 선택함)
  // 대화가 끝난 게 아니라 "새 상대를 기다리는 중"으로 넘어간 것이므로 다르게 처리해야 한다.
  private has_requested_replay = false;
  // 결과 화면에서 내가 재시작/나가기를 고르기 전에 상대가 먼저 나간 경우 — 결과 팝업은 그대로 두고,
  // 재시작을 누르면 상대 응답을 기다릴 필요 없이 바로 새 상대를 기다리는 상태로 넘어간다.
  private opponent_left_at_result = false;
  // '나가기'를 눌러서 스스로 끊는 중인지 — 아니면 onLeave 는 예기치 않은 오류로 취급한다.
  private exit_requested = false;
  // RETURN_TO_LOBBY 와 onLeave(CONSENTED) 가 같은 상황에서 둘 다 올 수 있어, 로비 전환은 한 번만 한다.
  private returned_to_lobby = false;
  // GAME_START 효과 배너를 5초 뒤에 지우는 타이머. 돌 색 선택이 먼저 시작되면 그때 바로 지우고 취소한다.
  private banner_timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: OthelloSceneOptions) {
    this.options = options;
    this.connection = new OthelloConnection(options.room);

    this.status = new Text({
      text: "",
      style: { fill: 0xff6b6b, fontSize: 18, fontFamily: "sans-serif", align: "center", wordWrap: true, wordWrapWidth: 640 },
    });
    this.status.anchor.set(0.5, 0);

    this.round_status = new Text({
      text: "",
      style: { fill: 0xeaeaea, fontSize: 20, fontFamily: "sans-serif", align: "center", wordWrap: true, wordWrapWidth: 640 },
    });
    this.round_status.anchor.set(0.5, 0);

    // 재접속 안내 — 서버가 진행 중인 판의 보드 상태를 다시 보내주지 않아 화면 보드가 실제와 다를 수 있다.
    this.rejoin_notice = new Text({
      text: "",
      style: { fill: 0xffd257, fontSize: 15, fontFamily: "sans-serif", align: "center", wordWrap: true, wordWrapWidth: 640 },
    });
    this.rejoin_notice.anchor.set(0.5, 0);

    // 보드 위 돌 개수 — 두 사용자 패널 사이에 표기.
    this.score_text = new Text({
      text: "",
      style: { fill: 0xffffff, fontSize: 24, fontFamily: "sans-serif", fontWeight: "bold" },
    });
    this.score_text.anchor.set(0.5, 0);

    // DOLL_SELECT_REMAIN_TIME / TURN_REMAIN_TIME 의 남은 시간 — 화면 하단에 표기.
    this.countdown_text = new Text({
      text: "",
      style: { fill: 0xffffff, fontSize: 28, fontFamily: "sans-serif", fontWeight: "bold" },
    });
    this.countdown_text.anchor.set(0.5, 0);

    this.board = new OthelloBoard({ onSelect: (point) => this.OnSelectPoint(point) });

    this.ready_button = new Button({ label: "게임 준비", width: 440, height: 88, onClick: () => this.OnClickReady() });
    this.ready_button.SetEnabled(false);
    this.ready_button.visible = false;

    this.color_panel = new OthelloColorPanel({ onSelect: (color) => this.OnSelectColor(color) });
    this.color_panel.visible = false;

    this.auto_mode_button = new Button({
      label: "오토모드: OFF",
      width: 190,
      height: 48,
      onClick: () => this.OnClickAutoMode(),
    });

    this.result_popup = new GameResultPopup({
      onReplay: () => this.OnClickReplay(),
      onExit: () => this.OnClickExit(),
    });

    this.back_to_lobby_button = new Button({
      label: "로비로 돌아가기",
      width: 440,
      height: 88,
      onClick: () => this.GoToLobbyOnce(),
    });
    this.back_to_lobby_button.visible = false;

    this.view.addChild(
      this.opponent_panel,
      this.my_panel,
      this.score_text,
      this.board,
      this.status,
      this.round_status,
      this.rejoin_notice,
      this.countdown_text,
      this.ready_button,
      this.color_panel,
      this.auto_mode_button,
      this.result_popup,
      this.back_to_lobby_button,
      this.game_start_banner
    );
    this.UpdateScore();

    this.connection.Listen({
      onEnterRoom: (envelope) => this.HandleEnterRoom(envelope.payload),
      onOutUser: (envelope) => this.HandleOutUser(envelope.payload),
      onGameStart: () => this.HandleGameStart(),
      onDollSelectRemainTime: (envelope) => this.HandleDollSelectRemainTime(envelope.payload),
      onDollSelectResult: (envelope) => this.HandleDollSelectResult(envelope.payload),
      onTurnStart: (envelope) => this.HandleTurnStart(envelope.payload),
      onTurnRemainTime: (envelope) => this.HandleTurnRemainTime(envelope.payload),
      onSelectGameResult: (envelope) => this.HandleSelectGameResult(envelope.payload),
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
    const gap = 40;

    this.opponent_panel.position.set(center_x - gap / 2 - AVATAR_SIZE, 40);
    this.my_panel.position.set(center_x + gap / 2, 40);
    this.score_text.position.set(center_x, 300);
    // 보드 위 왼쪽 끝(돌 개수 표기와 같은 줄)에 둔다.
    this.auto_mode_button.position.set(center_x - OTHELLO_BOARD_PIXEL_SIZE / 2, 290);
    this.board.position.set(center_x - OTHELLO_BOARD_PIXEL_SIZE / 2, 340);
    this.status.position.set(center_x, 990);
    this.round_status.position.set(center_x, 1030);
    this.rejoin_notice.position.set(center_x, 1062);
    this.countdown_text.position.set(center_x, 1090);
    this.ready_button.position.set(center_x - this.ready_button.width / 2, 1140);
    this.color_panel.position.set(center_x - OTHELLO_COLOR_PANEL_WIDTH / 2, 1140);
    this.back_to_lobby_button.position.set(center_x - this.back_to_lobby_button.width / 2, 1140);
  }

  public Destroy(): void {
    if (this.banner_timer) clearTimeout(this.banner_timer);
    this.CancelAutoPlay();
    this.view.destroy({ children: true });
  }

  // player1/player2 중 어느 쪽이 나인지 표시가 없어 userid 로 직접 구분한다.
  private HandleEnterRoom(payload: EnterRoomPayload): void {
    const is_player1_me = payload.player1.userid === this.options.my_userid;
    const me = is_player1_me ? payload.player1 : payload.player2;
    const opponent = is_player1_me ? payload.player2 : payload.player1;

    this.opponent_panel.SetInfo(opponent);
    this.my_panel.SetInfo(me);
    // 재시작 후 상대를 기다리던 중이었다면 떠 있던 '로비로 돌아가기' 버튼을 치운다 — 새 방/상대로 진행된다.
    this.back_to_lobby_button.visible = false;

    if (this.options.is_rejoin) {
      // 게임 도중 재접속 — 이미 판이 진행 중이므로 '게임 준비' 버튼 없이 안내만 표시한다.
      // 서버는 이 유저의 ENTER_ROOM 을 기다리지 않고 진행하므로, TURN_START 등이 이 응답보다 먼저 도착해
      // 이미 내 차례 안내가 떠 있을 수 있다 — 그 경우 "대기중"으로 덮어쓰지 않는다.
      if (this.status.text === "") {
        this.status.text = "대기중";
      }
      this.rejoin_notice.text =
        "재접속했습니다. 현재 판 상태(GAME_STATUS)를 받기 전까지는 화면 보드가 실제와 다를 수 있습니다. (놓을 자리 표시는 정확합니다)";
      return;
    }

    this.ready_button.visible = true;
    this.ready_button.SetEnabled(true);
  }

  private HandleOutUser(payload: OutUserPayload): void {
    console.log(`${LOG_TAG} 퇴장 알림 userid=${payload.userid}`);

    // '재시작'을 신청해놓고 응답을 기다리던 중이었다면, 대화 종료가 아니라 새 상대를 기다리는 상태로 넘어간 것이다
    // (서버: WaitForNewOpponent — 대기 시간 제한 없음, OPPONENT_JOINED 가 오면 이어서 진행).
    if (this.has_requested_replay) {
      this.HandleWaitingForOpponent();
      return;
    }

    // 결과 화면(재시작/나가기 선택 대기 중)에서 상대가 먼저 나간 경우 — 나는 아직 선택 전이니
    // 결과 팝업을 닫지 말고 그대로 둔다. 재시작을 누르면 OnClickReplay() 에서 바로 대기 상태로 넘어간다.
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
  // 서버 쪽 대기 시간 제한이 없으므로 무한정 기다릴 수도 있어, 직접 나갈 수 있게 '로비로 돌아가기' 버튼을 함께 보여준다
  // — 이 버튼은 서버에 아무 값도 보내지 않고 클라이언트에서 로비 씬으로 화면만 전환한다.
  private HandleWaitingForOpponent(): void {
    this.status.text = "새 상대를 기다리는 중...";
    this.opponent_panel.SetInfo({ userid: "-", name: "-", avatar: "-", win_per: 0 });
    this.opponent_panel.SetNote("");
    this.ready_button.visible = false;
    this.StopPlayUi();
    this.result_popup.Hide();
    this.back_to_lobby_button.visible = true;
  }

  // 기다리던 새 상대가 입장했다. 서버가 곧 뒤이어 보내는 ENTER_ROOM 응답에 player1/player2 가 다시 담겨 오므로
  // 그걸 기준으로 한 번에 그린다.
  private HandleOpponentJoined(_payload: OpponentJoinedPayload): void {
    this.status.text = "상대를 찾았습니다! 입장 중...";
    this.connection.SendEnterRoom();
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "ENTER_ROOM" })}`);
  }

  private OnClickReady(): void {
    this.connection.SendReady({ ready: "Y" });
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "READY", payload: { ready: "Y" } })}`);
    this.ready_button.SetEnabled(false);
  }

  // 서버가 양쪽 ready:Y 를 확인하면 온다 — 새 판이므로 보드와 돌 색을 초기화하고 GAME START 효과를 5초 보여준다.
  // 이 뒤에 서버가 돌 색 선택(DOLL_SELECT_REMAIN_TIME)을 시작한다.
  private HandleGameStart(): void {
    this.has_requested_replay = false;
    this.opponent_left_at_result = false;
    this.ready_button.visible = false;
    this.back_to_lobby_button.visible = false;
    this.result_popup.Hide();
    this.status.text = "";
    this.round_status.text = "";
    this.rejoin_notice.text = "";
    this.countdown_text.text = "";

    this.ResetBoardState();
    this.color_panel.visible = false;

    if (this.banner_timer) clearTimeout(this.banner_timer);
    this.game_start_banner.Show();
    this.banner_timer = setTimeout(() => this.game_start_banner.Hide(), GAME_START_BANNER_DURATION_MS);
  }

  // 돌 색 선택 남은 시간 — 첫 알림이 오면 GAME START 효과를 치우고 선택 패널을 보여준다.
  private HandleDollSelectRemainTime(payload: OthelloRemainTimePayload): void {
    this.HideGameStartBanner();
    this.countdown_text.text = `${payload.count}초`;

    // 이미 색이 정해졌거나(재접속 등으로 늦게 받은 알림) 내가 이미 골랐다면 선택 패널을 다시 열지 않는다.
    if (this.my_color !== null) return;
    this.color_panel.visible = true;
    this.color_panel.SetEnabled(!this.color_requested);
    if (!this.color_requested) {
      this.status.text = "돌 색을 선택하세요. (시간 안에 아무도 고르지 않으면 랜덤으로 정해집니다)";
    }
  }

  private OnSelectColor(color: OthelloColor): void {
    this.color_requested = true;
    this.connection.SendDollSelect({ color });
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "DOLL_SELECT", payload: { color } })}`);
    this.status.text = `선택함: ${this.DescribeColor(color)} 돌`;
  }

  // 돌 색 선택 결과 — select 는 {색: userid}. 내 userid 가 어느 색에 들어 있는지로 내 돌 색을 정한다.
  // 이 5초 뒤에 첫 TURN_START(검정 선공)가 온다.
  private HandleDollSelectResult(payload: OthelloDollSelectResultPayload): void {
    this.HideGameStartBanner();
    this.color_panel.visible = false;
    this.countdown_text.text = "";

    if (!this.ApplyColorSelect(payload.select) || this.my_color === null) return; // 내 userid 가 없는 비정상 응답
    this.status.text = `돌 색이 정해졌습니다. 나는 ${this.DescribeColor(this.my_color)} 돌입니다. (검정이 선공)`;
  }

  // 게임 중 재접속 — 서버가 재접속 당사자에게만 보내는 현재 상태(GAME_STATUS)로 돌 색과 보드를 복원한다.
  // TURN_START(놓을 자리/내 차례 안내)는 이 메시지와 별개로 오므로 여기서는 건드리지 않는다.
  private HandleGameStatus(payload: OthelloGameStatusPayload): void {
    this.HideGameStartBanner();
    this.color_panel.visible = false;
    this.ApplyColorSelect(payload.select);
    this.board.SetStones(payload.status0, payload.status1);
    this.UpdateScore();
    this.rejoin_notice.text = ""; // 상태를 복원했으니 "보드가 다를 수 있음" 안내는 더 이상 필요 없다.

    // 지금 차례인 유저가 있으면 TURN_START 를 받은 것과 똑같이 처리한다 — 내 차례면 놓을 자리(can)가 표시되고
    // 바로 둘 수 있으며(오토모드면 자동으로), 상대 차례면 "상대 차례" 안내와 패널 강조만 한다.
    if (payload.turn) {
      this.HandleTurnStart({ turn: payload.turn, can: payload.can ?? [] });
    }
    if (this.status.text === "" || this.status.text === "대기중") {
      this.status.text = "재접속했습니다. 진행 중인 판을 이어서 보여줍니다.";
    }
  }

  // DOLL_SELECT/GAME_STATUS 의 select({색: userid})에서 내 돌 색을 정하고 두 패널에 표기한다.
  // 내 userid 가 없는 비정상 응답이면 false.
  private ApplyColorSelect(select: Record<string, string>): boolean {
    for (const [color_key, userid] of Object.entries(select)) {
      if (userid === this.options.my_userid) {
        this.my_color = Number(color_key) === OthelloColor.WHITE ? OthelloColor.WHITE : OthelloColor.BLACK;
      }
    }
    if (this.my_color === null) return false;

    this.my_panel.SetNote(`돌: ${this.DescribeColor(this.my_color)}`);
    this.opponent_panel.SetNote(`돌: ${this.DescribeColor(this.GetOppositeColor(this.my_color))}`);
    return true;
  }

  // 돌을 놓을 차례 — turn 이 내 userid 면 can(놓을 수 있는 자리)을 보드에 표시한다.
  // 별도 PASS 메시지는 없어서, 같은 유저가 연속으로 turn 이 되면 상대가 패스한 것으로 안내한다.
  private HandleTurnStart(payload: OthelloTurnStartPayload): void {
    this.HideGameStartBanner();
    this.color_panel.visible = false;

    const is_me = payload.turn === this.options.my_userid;
    this.round_status.text =
      this.last_turn_userid === payload.turn ? (is_me ? "상대가 놓을 곳이 없어 패스했습니다." : "내가 놓을 곳이 없어 패스했습니다.") : "";
    this.last_turn_userid = payload.turn;

    this.is_my_turn = is_me;
    this.my_turn_can = is_me ? payload.can : [];
    this.board.SetHints(this.my_turn_can);
    this.SetTurnHighlight(is_me);
    this.status.text = is_me
      ? this.is_auto_mode
        ? "내 차례입니다. 오토모드로 자동으로 둡니다."
        : "내 차례입니다. 노란 점이 있는 자리에 돌을 놓으세요."
      : "상대 차례입니다.";

    this.CancelAutoPlay();
    if (is_me && this.is_auto_mode) this.ScheduleAutoPlay();
  }

  // 오토모드 켜기/끄기. 내 차례 도중에 켜면 그 차례에서도 바로 자동으로 둔다(끄면 예약된 자동 착수를 취소하고
  // 직접 두면 된다 — 놓을 자리 표시는 그대로 남아 있다).
  private OnClickAutoMode(): void {
    this.is_auto_mode = !this.is_auto_mode;
    this.auto_mode_button.SetLabel(this.is_auto_mode ? "오토모드: ON" : "오토모드: OFF");

    if (!this.is_auto_mode) {
      this.CancelAutoPlay();
      if (this.is_my_turn) this.status.text = "내 차례입니다. 노란 점이 있는 자리에 돌을 놓으세요.";
      return;
    }
    if (this.is_my_turn) {
      this.status.text = "내 차례입니다. 오토모드로 자동으로 둡니다.";
      this.ScheduleAutoPlay();
    }
  }

  // 이번 차례에 놓을 수 있는 자리(my_turn_can) 중 하나를 골라 잠시 뒤 직접 두는 것과 똑같이 SELECT_GAME 으로 보낸다.
  private ScheduleAutoPlay(): void {
    this.CancelAutoPlay();
    if (this.my_turn_can.length === 0) return;

    this.auto_play_timer = setTimeout(() => {
      this.auto_play_timer = null;
      // 대기하는 사이 차례가 끝났거나(상대 퇴장/시간 초과 등) 오토모드를 껐다면 두지 않는다.
      if (!this.is_my_turn || !this.is_auto_mode || this.my_turn_can.length === 0) return;
      const choice = this.my_turn_can[Math.floor(Math.random() * this.my_turn_can.length)];
      this.OnSelectPoint(choice);
    }, AUTO_PLAY_DELAY_MS);
  }

  private CancelAutoPlay(): void {
    if (this.auto_play_timer) {
      clearTimeout(this.auto_play_timer);
      this.auto_play_timer = null;
    }
  }

  private HandleTurnRemainTime(payload: OthelloRemainTimePayload): void {
    this.countdown_text.text = `${payload.count}초`;
  }

  private OnSelectPoint(point: OthelloPoint): void {
    if (!this.is_my_turn) return;
    this.is_my_turn = false;
    this.my_turn_can = [];
    this.CancelAutoPlay(); // 직접 둔 경우 예약돼 있던 자동 착수가 또 나가지 않게 한다.
    this.board.SetHints([]); // 같은 턴에 중복으로 보내지 않게 바로 끈다(결과는 SELECT_GAME 으로 온다).
    this.connection.SendSelectGame({ select: point });
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "SELECT_GAME", payload: { select: point } })}`);
    this.status.text = "착수했습니다.";
  }

  // 착수 결과 — 놓은 유저의 돌을 그리고, change 의 좌표(뒤집히는 상대 돌)를 같은 색으로 바꾼다.
  // 이 2초 뒤에 다음 TURN_START 가 온다. 시간 초과로 서버가 대신 둔 수도 같은 메시지로 온다.
  private HandleSelectGameResult(payload: OthelloSelectGameResultPayload): void {
    const { userid, x, y } = payload.select;
    const is_me = userid === this.options.my_userid;

    this.is_my_turn = false;
    this.my_turn_can = [];
    this.CancelAutoPlay();
    this.board.SetHints([]);
    this.countdown_text.text = "";
    this.SetTurnHighlight(null);

    if (this.my_color === null) {
      // 재접속했는데 아직 GAME_STATUS 를 못 받아 돌 색을 모르는 경우 — 어느 색으로 그려야 하는지 알 수 없어
      // 돌은 그리지 않고 좌표만 안내한다(GAME_STATUS 가 오면 보드를 통째로 복원한다).
      this.round_status.text = `${is_me ? "나" : "상대"}가 (${x + 1}, ${y + 1})에 놓았습니다.`;
      return;
    }

    const placed_color = is_me ? this.my_color : this.GetOppositeColor(this.my_color);
    this.board.PlaceStone({ x, y }, placed_color);
    this.board.FlipStones(payload.change, placed_color);
    this.UpdateScore();
    this.round_status.text = `${is_me ? "나" : "상대"}가 (${x + 1}, ${y + 1})에 놓아 ${payload.change.length}개를 뒤집었습니다.`;
  }

  // 최종 결과 — win_count 는 승리 횟수가 아니라 최종 돌 개수다. draw:"Y" 면 동수 무승부.
  private HandleGameResult(payload: OthelloGameResultPayload): void {
    const am_i_winner = payload.winner.userid === this.options.my_userid;
    const me = am_i_winner ? payload.winner : payload.loser;
    const opponent = am_i_winner ? payload.loser : payload.winner;
    const is_draw = payload.draw === "Y";

    // ENTER_ROOM 때 보여준 사용자 정보 뷰(userid/name/win_per)의 win_per 를 최신 값으로 갱신한다.
    this.my_panel.UpdateWinPer(me.win_per);
    this.opponent_panel.UpdateWinPer(opponent.win_per);

    this.StopPlayUi();
    this.UpdateScore();
    const outcome = is_draw ? "무승부" : am_i_winner ? "승리" : "패배";
    this.result_popup.Show(
      `나: ${me.win_count}개 (승률 ${me.win_per}%)  상대: ${opponent.win_count}개 (승률 ${opponent.win_per}%)\n결과: ${outcome}`
    );
  }

  private OnClickReplay(): void {
    this.has_requested_replay = true;
    this.connection.SendReplay({ replay: "Y" });
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "GAME_RESULT", payload: { replay: "Y" } })}`);

    // 재시작을 고르면 이전 판의 말판을 바로 비운다(새 판은 GAME_START 에서 다시 초기 배치로 시작한다).
    this.ResetBoardState();

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

  // RETURN_TO_LOBBY 로 이미 로비로 옮겨갔다면(GoToLobbyOnce) 여기서는 아무것도 하지 않는다.
  // 내가 '나가기'로 스스로 끊은 것(CONSENTED)이 아니면, 조용히 로비로 돌려보내지 않고
  // 무슨 일이 있었는지 보여준 뒤 직접 로비로 돌아갈 수 있게 한다.
  private HandleLeave(code?: number): void {
    if (this.returned_to_lobby) return;

    if (this.exit_requested || code === CloseCode.CONSENTED) {
      this.GoToLobbyOnce();
      return;
    }

    this.status.text = `게임 채널 연결이 끊어졌습니다 (code=${code ?? "-"}). 서버 쪽 문제일 수 있습니다.`;
    this.ready_button.visible = false;
    this.StopPlayUi();
    this.result_popup.Hide();
    this.back_to_lobby_button.visible = true;
  }

  // RETURN_TO_LOBBY, onLeave(CONSENTED), '로비로 돌아가기' 버튼 중 무엇이 먼저 오든 한 번만 전환한다.
  private GoToLobbyOnce(): void {
    if (this.returned_to_lobby) return;
    this.returned_to_lobby = true;
    this.options.onExitToLobby();
  }

  // 말판을 초기 배치로 비우고, 판마다 새로 정해지는 상태(돌 색/차례/돌 색 표기/차례 강조)를 지운다.
  // 재시작을 고른 직후와 새 판(GAME_START) 시작 두 곳에서 쓴다.
  private ResetBoardState(): void {
    this.board.Reset();
    this.UpdateScore();
    this.my_color = null;
    this.color_requested = false;
    this.is_my_turn = false;
    this.last_turn_userid = null;
    this.my_panel.SetNote("");
    this.opponent_panel.SetNote("");
    this.SetTurnHighlight(null);
  }

  // 판 진행 중에만 의미 있는 UI(돌 색 선택/놓을 자리/남은 시간/연출 배너)를 모두 끈다.
  // 상대 퇴장, 연결 끊김, 최종 결과, 새 상대 대기처럼 판이 더 이어지지 않는 모든 경로에서 쓴다.
  private StopPlayUi(): void {
    this.is_my_turn = false;
    this.my_turn_can = [];
    this.CancelAutoPlay();
    this.board.SetHints([]);
    this.color_panel.visible = false;
    this.countdown_text.text = "";
    this.round_status.text = "";
    this.SetTurnHighlight(null);
    this.HideGameStartBanner();
  }

  private HideGameStartBanner(): void {
    if (this.banner_timer) {
      clearTimeout(this.banner_timer);
      this.banner_timer = null;
    }
    this.game_start_banner.Hide();
  }

  // 내 차례면 내 패널을, 상대 차례면 상대 패널을 또렷하게 보여준다. null 이면 둘 다 평소대로.
  private SetTurnHighlight(is_my_turn: boolean | null): void {
    this.my_panel.alpha = is_my_turn === false ? WAITING_PANEL_ALPHA : 1;
    this.opponent_panel.alpha = is_my_turn === true ? WAITING_PANEL_ALPHA : 1;
  }

  // 보드 위 돌 개수 표기("흑 2 : 백 2").
  private UpdateScore(): void {
    const { black, white } = this.board.CountStones();
    this.score_text.text = `검정 ${black} : ${white} 흰색`;
  }

  private GetOppositeColor(color: OthelloColor): OthelloColor {
    return color === OthelloColor.WHITE ? OthelloColor.BLACK : OthelloColor.WHITE;
  }

  private DescribeColor(color: OthelloColor): string {
    return color === OthelloColor.WHITE ? "흰색" : "검정";
  }
}
