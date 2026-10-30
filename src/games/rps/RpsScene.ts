// 가위바위보 게임방 씬 — 씬이 만들어지면 바로 ENTER_ROOM 을 요청하고, 응답을 받으면
// 왼쪽에 상대 정보 / 오른쪽에 내 정보를 표시한 뒤 '게임 준비' 버튼을 활성화한다.
// 준비가 끝나면 GAME_START -> (ONE_START -> ONE_REMAIN_TIME* -> 선택 -> ONE_RESULT) 반복 -> GAME_RESULT 순으로 진행한다.
import { Container, Text } from "pixi.js";
import type { Room } from "@colyseus/sdk";
import type { Scene } from "../../scenes/Scene";
import { Button } from "../../ui/Button";
import { PlayerPanel, AVATAR_SIZE } from "../../ui/PlayerPanel";
import { RpsChoicePanel, RPS_PANEL_WIDTH } from "./RpsChoicePanel";
import {
  CUTE_COLOR,
  CUTE_FONT_FAMILY,
  CUTE_THEME,
  CreateCuteBackground,
  CreatePlayerCard,
  PLAYER_CARD_WIDTH,
  PLAYER_CARD_PADDING_X,
} from "../../ui/CuteTheme";
import { RpsFlagDuck } from "./RpsFlagDuck";
import { Confetti } from "../../ui/Confetti";
import { GameResultPopup, RESULT_SCREEN_DIM_ALPHA } from "../../ui/GameResultPopup";
import { GameStartBanner } from "../../ui/GameStartBanner";
import type { NoticeBanner } from "../../ui/NoticeBanner";
import { ConnectionLostPopup } from "../../ui/ConnectionLostPopup";
import { RpsConnection } from "./RpsConnection";
import type {
  EnterRoomPayload,
  OutUserPayload,
  GameResultPayload,
  OpponentJoinedPayload,
} from "../../common/types";
import type { OneRemainTimePayload, OneResultPayload, RpsChoice } from "./types";

const LOG_TAG = "[Game]";

// GAME_START 연출(효과 배너)을 보여주는 시간. 이 동안은 가위바위보를 낼 수 없다.
const GAME_START_BANNER_DURATION_MS = 5000;
// ONE_RESULT 를 오리 깃발로 보여주는 시간. 끝나면 깃발을 내리고 가위바위보 버튼을 회색(다음 판 대기)으로 돌린다.
const ROUND_RESULT_DURATION_MS = 5000;

// 두 사용자 정보 카드 사이 간격(가운데에 VS 표기).
const CARD_GAP = 60;

export interface RpsSceneOptions {
  room: Room;
  // player1/player2 중 내 쪽을 구분하기 위한 값 (ENTER_ROOM 은 name/avatar/win_per 까지 다 담아 오므로 이것만 있으면 된다).
  my_userid: string;
  // REJOIN_GAME 으로 들어온 경우 true — 이미 라운드가 진행 중이므로 ENTER_ROOM 응답을 받아도
  // '게임 준비' 버튼을 보여주지 않고 "대기중"만 표시한다.
  is_rejoin: boolean;
  notice_banner: NoticeBanner;
  // 로비로 돌아갈 때 새 로비 씬을 만들기 위한 콜백 (새 로비 씬은 뜨자마자 스스로 접속을 시도한다).
  onExitToLobby: () => void;
}

export class RpsScene implements Scene {
  readonly view = new Container();

  private readonly status: Text;
  private readonly round_status: Text;
  private readonly countdown_text: Text;
  private readonly title_text: Text;
  private readonly vs_text: Text;
  private readonly opponent_card = CreatePlayerCard("상대", CUTE_COLOR.shirt_dark);
  private readonly my_card = CreatePlayerCard("나", CUTE_COLOR.orange);
  // 한 판 결과를 이긴 쪽 깃발을 들어 보여주는 오리 캐릭터 (왼쪽=상대, 오른쪽=나). 시트 이미지(duck_flags.png)의 그림을 바꿔 보여준다.
  private readonly duck = new RpsFlagDuck();
  // 최종 결과(GAME_RESULT) 때 뿌리는 색종이.
  private readonly confetti = new Confetti();
  private readonly opponent_panel = new PlayerPanel(CUTE_THEME);
  private readonly my_panel = new PlayerPanel(CUTE_THEME);
  private readonly ready_button: Button;
  private readonly rps_panel: RpsChoicePanel;
  private readonly game_start_banner = new GameStartBanner(CUTE_THEME);
  private readonly result_popup: GameResultPopup;
  private readonly back_to_lobby_button: Button;
  // 서버가 꺼졌거나 연결이 예기치 않게 끊겼을 때 — 버튼으로 로비에 접속하게 유도한다.
  private readonly connection_lost_popup: ConnectionLostPopup;
  private readonly connection: RpsConnection;
  private readonly options: RpsSceneOptions;
  // player1/player2 중 어느 쪽이 나인지 — ENTER_ROOM 에서 한 번 정해지면 이 방에서는 계속 유지된다.
  private is_player1_me = true;
  // GAME_RESULT 는 userid 만 주므로, 최종 결과 플랜카드에 쓸 별명을 ENTER_ROOM 때 기억해 둔다.
  private my_name = "";
  private opponent_name = "";
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
  // GAME_START 효과 배너를 5초 뒤에 지우는 타이머. ONE_START 가 먼저 오면 그때 바로 지우고 취소한다.
  private banner_timer: ReturnType<typeof setTimeout> | null = null;
  // ONE_RESULT 표시(오리 깃발)를 5초 뒤에 거두는 타이머. 다음 ONE_START 가 먼저 오면 그때 바로 거둔다.
  private round_result_timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RpsSceneOptions) {
    this.options = options;
    this.connection = new RpsConnection(options.room);

    this.status = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.red,
        fontSize: 20,
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
        fontSize: 24,
        fontFamily: CUTE_FONT_FAMILY,
        align: "center",
        stroke: { color: 0xffffff, width: 5, join: "round" },
      },
    });
    this.round_status.anchor.set(0.5, 0);

    // ONE_REMAIN_TIME 의 남은 시간 — 화면 중앙 하단에 표기.
    this.countdown_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 44,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 8, join: "round" },
      },
    });
    this.countdown_text.anchor.set(0.5, 0);

    this.title_text = new Text({
      text: "가위 바위 보!",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 60,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 10, join: "round" },
        dropShadow: { color: CUTE_COLOR.orange_dark, alpha: 0.5, distance: 5, angle: Math.PI / 2, blur: 0 },
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

    this.ready_button = new Button({
      label: "게임 준비",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.OnClickReady(),
    });
    this.ready_button.SetEnabled(false);
    this.ready_button.visible = false;

    this.rps_panel = new RpsChoicePanel({ onSelect: (choice) => this.OnSelectChoice(choice) });
    this.rps_panel.visible = false;

    this.result_popup = new GameResultPopup({
      onReplay: () => this.OnClickReplay(),
      onExit: () => this.OnClickExit(),
      theme: CUTE_THEME,
      // 승리 깃발을 든 오리가 보이도록 작게 만들어 오리 발 아래에 띄우고, 뒤 게임 화면은 옅은 검정으로 덮어 결과 화면과 분리한다.
      layout: { panel_width: 520, panel_height: 290, panel_y: 830, button_height: 56, dim_alpha: RESULT_SCREEN_DIM_ALPHA },
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
      theme: CUTE_THEME,
    });

    this.view.addChild(
      CreateCuteBackground(),
      this.title_text,
      this.opponent_card,
      this.my_card,
      this.vs_text,
      this.opponent_panel,
      this.my_panel,
      this.status,
      this.round_status,
      this.countdown_text,
      this.ready_button,
      this.rps_panel,
      this.result_popup,
      // 결과 팝업의 덮개보다 위에 둬서 오리가 어두워지지 않게 한다(팝업 패널/선택 버튼과는 겹치지 않는다).
      this.duck,
      this.back_to_lobby_button,
      this.confetti,
      this.game_start_banner,
      this.connection_lost_popup
    );

    this.connection.Listen({
      onEnterRoom: (envelope) => this.HandleEnterRoom(envelope.payload),
      onOutUser: (envelope) => this.HandleOutUser(envelope.payload),
      onGameStart: () => this.HandleGameStart(),
      onOneStart: () => this.HandleOneStart(),
      onOneRemainTime: (envelope) => this.HandleOneRemainTime(envelope.payload),
      onOneResult: (envelope) => this.HandleOneResult(envelope.payload),
      onGameResult: (envelope) => this.HandleGameResult(envelope.payload),
      onReturnToLobby: () => this.GoToLobbyOnce(),
      onOpponentJoined: (envelope) => this.HandleOpponentJoined(envelope.payload),
      onNotice: (envelope) => this.options.notice_banner.Show(envelope.payload.message),
      onLeave: (code) => this.HandleLeave(code),
    });

    this.connection.SendEnterRoom();
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "ENTER_ROOM" })}`);
  }

  public Resize(width: number, height: number): void {
    const center_x = width / 2;
    const panel_y = 190;

    this.title_text.position.set(center_x, 40);
    this.opponent_card.position.set(center_x - CARD_GAP / 2 - PLAYER_CARD_WIDTH, panel_y - 20);
    this.my_card.position.set(center_x + CARD_GAP / 2, panel_y - 20);
    this.opponent_panel.position.set(this.opponent_card.x + PLAYER_CARD_PADDING_X, panel_y);
    this.my_panel.position.set(this.my_card.x + PLAYER_CARD_PADDING_X, panel_y);
    this.vs_text.position.set(center_x, panel_y + AVATAR_SIZE / 2);
    this.status.position.set(center_x, 486);
    // 오리는 발 가운데가 기준점이다.
    this.duck.position.set(center_x, 815);
    this.round_status.position.set(center_x, 812);
    this.ready_button.position.set(center_x - this.ready_button.width / 2, 900);
    this.rps_panel.position.set(center_x - RPS_PANEL_WIDTH / 2, 880);
    this.back_to_lobby_button.position.set(center_x - this.back_to_lobby_button.width / 2, 900);
    // 화면 중앙 하단.
    this.countdown_text.position.set(center_x, height - 140);
  }

  public Destroy(): void {
    // '로비로 돌아가기'는 방을 나가지 않고 화면만 바꾸므로, 이후 오는 게임 채널 메시지가 파괴된 씬을 건드리지 않게 콜백을 끊는다.
    this.connection.Dispose();
    if (this.banner_timer) clearTimeout(this.banner_timer);
    if (this.round_result_timer) clearTimeout(this.round_result_timer);
    this.view.destroy({ children: true });
  }

  // player1/player2 중 어느 쪽이 나인지 표시가 없어 userid 로 직접 구분한다.
  private HandleEnterRoom(payload: EnterRoomPayload): void {
    this.is_player1_me = payload.player1.userid === this.options.my_userid;
    const me = this.is_player1_me ? payload.player1 : payload.player2;
    const opponent = this.is_player1_me ? payload.player2 : payload.player1;

    this.opponent_panel.SetInfo(opponent);
    this.my_panel.SetInfo(me);
    this.my_name = me.name;
    this.opponent_name = opponent.name;
    // 재시작 후 상대를 기다리던 중이었다면 떠 있던 '로비로 돌아가기' 버튼을 치운다 — 새 방/상대로 진행된다.
    this.back_to_lobby_button.visible = false;

    if (this.options.is_rejoin) {
      // 게임 도중 재접속 — 이미 라운드가 진행 중이므로 '게임 준비' 버튼 없이 대기중만 표시한다.
      // 단, ONE_START/ONE_REMAIN_TIME 이 이 응답보다 먼저 도착해 이미 선택 화면이 떠 있다면
      // (서버 타이머는 이 유저의 ENTER_ROOM 을 기다리지 않는다) "대기중"으로 덮어쓰지 않는다.
      if (!this.rps_panel.visible) {
        this.status.text = "대기중";
      }
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
    this.ready_button.SetEnabled(false);
    this.rps_panel.visible = false;
    this.countdown_text.text = "";
    if (this.banner_timer) clearTimeout(this.banner_timer);
    this.game_start_banner.Hide();
    if (this.round_result_timer) clearTimeout(this.round_result_timer);
    this.duck.Reset();
    this.result_popup.Hide();
    this.back_to_lobby_button.visible = true;
  }

  // 재시작을 신청했는데 상대가 먼저 나가서, 새 상대가 이 방에 들어올 때까지 기다리는 상태를 보여준다.
  // 서버 쪽 대기 시간 제한이 없으므로(CLAUDE.md 게임 규칙 12번) 무한정 기다릴 수도 있어, 직접
  // 나갈 수 있게 '로비로 돌아가기' 버튼을 함께 보여준다 — 이 버튼은 서버에 아무 값도 보내지 않고
  // 클라이언트에서 로비 씬으로 화면만 전환한다(exit_requested 나 GAME_RESULT{replay} 같은 것도 안 보냄).
  private HandleWaitingForOpponent(): void {
    this.status.text = "새 상대를 기다리는 중...";
    this.opponent_panel.SetInfo({ userid: "-", name: "-", avatar: "-", win_per: 0 });
    this.ready_button.visible = false;
    this.rps_panel.visible = false;
    this.countdown_text.text = "";
    if (this.banner_timer) clearTimeout(this.banner_timer);
    this.game_start_banner.Hide();
    if (this.round_result_timer) clearTimeout(this.round_result_timer);
    this.duck.Reset();
    this.result_popup.Hide();
    this.back_to_lobby_button.visible = true;
  }

  // 기다리던 새 상대가 입장했다. 이 payload 로도 이미 표시할 수 있지만, 서버가 곧 뒤이어 보내는
  // ENTER_ROOM 응답에 player1/player2 가 다시 담겨 오므로 그걸 기준으로 한 번에 그린다.
  private HandleOpponentJoined(_payload: OpponentJoinedPayload): void {
    this.status.text = "상대를 찾았습니다! 입장 중...";
    this.connection.SendEnterRoom();
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "ENTER_ROOM" })}`);
  }

  private OnClickReady(): void {
    this.connection.SendReady({ ready: "Y" });
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "READY", payload: { ready: "Y" } })}`);
    this.ready_button.SetEnabled(false);
  }

  // 서버가 양쪽 ready:Y 를 확인하면 온다 — 곧바로 가위바위보를 노출하지 않고, GAME START 효과를
  // 5초 보여준 뒤 ONE_START 가 와야 비로소 선택 화면으로 넘어간다.
  private HandleGameStart(): void {
    this.confetti.Stop();
    this.has_requested_replay = false;
    this.opponent_left_at_result = false;
    this.ready_button.visible = false;
    this.back_to_lobby_button.visible = false;
    this.status.text = "";
    this.round_status.text = "";
    this.countdown_text.text = "";
    this.result_popup.Hide();
    this.duck.Reset();
    // 가위바위보 버튼은 미리 보여주되, ONE_START 전까지는 회색(누를 수 없음)으로 둔다.
    this.rps_panel.visible = true;
    this.rps_panel.SetWaiting();

    if (this.banner_timer) clearTimeout(this.banner_timer);
    this.game_start_banner.Show();
    this.banner_timer = setTimeout(() => this.game_start_banner.Hide(), GAME_START_BANNER_DURATION_MS);
  }

  // 한 판 시작 — GAME START 효과를 치우고 선택 화면으로 넘어간다. 남은 시간 표시는 ONE_REMAIN_TIME 이 맡는다.
  private HandleOneStart(): void {
    if (this.banner_timer) {
      clearTimeout(this.banner_timer);
      this.banner_timer = null;
    }
    this.game_start_banner.Hide();

    if (this.round_result_timer) {
      clearTimeout(this.round_result_timer);
      this.round_result_timer = null;
    }
    this.duck.Reset();

    this.status.text = ""; // 재접속 직후의 "대기중" 표시가 있었다면 지운다.
    this.round_status.text = "";
    this.countdown_text.text = "";
    this.rps_panel.visible = true;
    this.rps_panel.SetEnabled(true);
  }

  // 화면 중앙 하단에 남은 시간을 표기한다. count:0 이면 선택 시간이 끝난 것.
  private HandleOneRemainTime(payload: OneRemainTimePayload): void {
    this.countdown_text.text = `${payload.count}초`;
    if (payload.count === 0) {
      this.rps_panel.SetEnabled(false);
    }
  }

  private OnSelectChoice(choice: RpsChoice): void {
    this.connection.SendSelectGame({ select: choice });
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "SELECT_GAME", payload: { select: choice } })}`);
    this.round_status.text = `선택함: ${choice}`;
  }

  // 한 판 결과를 팝업으로 5초 보여준다. 다음 ONE_START 가 오면(또는 5초가 지나면) 사라진다.
  private HandleOneResult(payload: OneResultPayload): void {
    const my_choice = this.is_player1_me ? payload.player1 : payload.player2;
    const opponent_choice = this.is_player1_me ? payload.player2 : payload.player1;
    this.rps_panel.SetEnabled(false);
    this.countdown_text.text = "";

    if (this.round_result_timer) clearTimeout(this.round_result_timer);
    this.round_status.text = `나: ${my_choice}   상대: ${opponent_choice}`;
    this.ShowRoundWinner(payload.win);
    this.round_result_timer = setTimeout(() => this.HideRoundResult(), ROUND_RESULT_DURATION_MS);
  }

  private HandleGameResult(payload: GameResultPayload): void {
    const am_i_winner = payload.winner.userid === this.options.my_userid;
    const me = am_i_winner ? payload.winner : payload.loser;
    const opponent = am_i_winner ? payload.loser : payload.winner;
    // ENTER_ROOM 때 보여준 사용자 정보 뷰(userid/name/win_per)의 win_per 를 최신 값으로 갱신한다.
    this.my_panel.UpdateWinPer(me.win_per);
    this.opponent_panel.UpdateWinPer(opponent.win_per);
    if (this.round_result_timer) clearTimeout(this.round_result_timer);
    // 오리가 깃발 대신 승자 별명을 쓴 플랜카드를 들고 깡충깡충 뛰고, 색종이를 뿌린다.
    // 별명을 아직 모르면(ENTER_ROOM 전에 결과가 온 경우) userid 로 대신 쓴다.
    const winner_name = (am_i_winner ? this.my_name : this.opponent_name) || payload.winner.userid;
    if (am_i_winner) {
      this.duck.ShowFinalResult("right", winner_name, "최종 승리!", CUTE_COLOR.red);
    } else {
      this.duck.ShowFinalResult("left", winner_name, "최종 패배", CUTE_COLOR.shirt_dark);
    }
    this.confetti.Play();
    this.rps_panel.visible = false;
    this.round_status.text = "";
    this.countdown_text.text = "";
    this.result_popup.Show(
      `나: ${me.win_count}승 (승률 ${me.win_per}%)  상대: ${opponent.win_count}승 (승률 ${opponent.win_per}%)\n최종 승자: ${this.DescribeWinner(payload.winner.userid)}`
    );
  }

  private OnClickReplay(): void {
    this.has_requested_replay = true;
    this.connection.SendReplay({ replay: "Y" });
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "GAME_RESULT", payload: { replay: "Y" } })}`);

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
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "GAME_RESULT", payload: { replay: "N" } })}`);
    this.status.text = "나가는 중...";
  }

  // RETURN_TO_LOBBY 로 이미 로비로 옮겨갔다면(GoToLobbyOnce) 여기서는 아무것도 하지 않는다.
  // 내가 '나가기'로 스스로 끊은 것(CONSENTED)이 아니면, 조용히 로비로 돌려보내지 않고
  // 무슨 일이 있었는지 보여준 뒤 직접 로비로 돌아갈 수 있게 한다.
  private HandleLeave(code?: number): void {
    if (this.returned_to_lobby) return;

    // 서버 종료 시에도 CONSENTED 코드로 끊길 수 있어, 코드만으로 정상 종료로 보지 않는다.
    // 정상 종료는 내가 나가기를 눌렀거나(exit_requested) RETURN_TO_LOBBY 를 받은 경우(returned_to_lobby)뿐이다.
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
    this.rps_panel.visible = false;
    this.countdown_text.text = "";
    if (this.banner_timer) clearTimeout(this.banner_timer);
    this.game_start_banner.Hide();
    if (this.round_result_timer) clearTimeout(this.round_result_timer);
    this.duck.Reset();
    this.result_popup.Hide();
    this.back_to_lobby_button.visible = true;
  }

  // RETURN_TO_LOBBY, onLeave(나가기 요청 후), '로비로 돌아가기'/'로비로 접속' 버튼 중 무엇이 먼저 오든 한 번만 전환한다.
  private GoToLobbyOnce(): void {
    if (this.returned_to_lobby) return;
    this.returned_to_lobby = true;
    this.options.onExitToLobby();
  }

  // 최종 결과 문구용("최종 승자: 나/상대/무승부").
  private DescribeWinner(win: string | undefined): string {
    if (!win) return "무승부";
    return win === this.options.my_userid ? "나" : "상대";
  }

  // 한 판 결과 — 오리가 이긴 사람 쪽(왼쪽=상대 카드, 오른쪽=내 카드) 깃발을 들고 "승리!/패배/무승부"를 띄운다.
  private ShowRoundWinner(win: string | undefined): void {
    if (!win) {
      this.duck.ShowRoundResult(null, "무승부", CUTE_COLOR.brown);
      return;
    }
    if (win === this.options.my_userid) {
      this.duck.ShowRoundResult("right", "승리!", CUTE_COLOR.red);
      return;
    }
    this.duck.ShowRoundResult("left", "패배", CUTE_COLOR.shirt_dark);
  }

  // 결과 표시 시간이 끝나면 깃발을 내리고, 다음 ONE_START 전까지 가위바위보 버튼을 회색으로 둔다.
  private HideRoundResult(): void {
    this.round_result_timer = null;
    this.duck.Reset();
    this.round_status.text = "";
    this.rps_panel.SetWaiting();
  }
}
