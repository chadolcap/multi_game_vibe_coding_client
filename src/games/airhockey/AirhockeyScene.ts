// 에어하키 게임방 씬 — 씬이 만들어지면 바로 ENTER_ROOM 을 요청하고, 응답을 받으면 위쪽에 상대/내 정보를 표시한 뒤
// '게임 준비' 버튼을 활성화한다. 양쪽 준비가 끝나면 SERVE_SELECT(동전 던지기로 첫 서브 결정) -> (5초) -> GAME_START
// -> (3초) -> ONE_START{serve} 부터 실시간으로 진행한다. 판마다 퍽은 서브할 유저 쪽에 멈춘 채로 놓인다:
// 서버가 퍽 물리를 계산해 PUCK_MOVE 로 보내고, 나는 내 레버 좌표(LEVER_MOVE)만 보내며, 상대 레버는 서버가 중계한다.
// 골이 나면 ONE_RESULT -> (3초) -> 다음 ONE_START, 누군가 3골을 넣으면 GAME_RESULT 로 끝난다.
// 테이블은 내 골대가 아래, 상대 골대가 위다(서버가 좌표를 받는 유저 기준으로 뒤집어 보낸다).
// 방 입장/퇴장/재시작 흐름은 SteppingScene 과 같다.
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
} from "../../ui/CuteTheme";
import { DuckMascot } from "../../ui/DuckMascot";
import { Confetti } from "../../ui/Confetti";
import { AirhockeyConnection } from "./AirhockeyConnection";
import { AirhockeyTable, TABLE_SCREEN_WIDTH, TABLE_SCREEN_HEIGHT, WALL_THICKNESS } from "./AirhockeyTable";
import { AirhockeyCoinToss } from "./AirhockeyCoinToss";
import type { EnterRoomPayload, OutUserPayload, OpponentJoinedPayload } from "../../common/types";
import {
  AIRHOCKEY_WIN_GOALS,
  type AirhockeyGameResultPayload,
  type AirhockeyGameStatusPayload,
  type AirhockeyLeverMoveResultPayload,
  type AirhockeyOneResultPayload,
  type AirhockeyOneStartPayload,
  type AirhockeyPoint,
  type AirhockeyServeSelectPayload,
} from "./types";

const LOG_TAG = "[Game]";

// GAME_START 연출(효과 배너)을 보여주는 시간. 서버는 GAME_START 3초 뒤 첫 ONE_START 를 보낸다.
const GAME_START_BANNER_DURATION_MS = 1200;
// ONE_START 때 "시작!" 문구를 보여주는 시간.
const ROUND_START_MESSAGE_MS = 900;
// 재접속 안내("별명님 재접속했습니다.")를 보여주는 시간.
const REJOIN_NOTICE_MS = 5000;

// 화면 세로 배치(720x1280 기준). 타이틀 → 사용자 정보 카드(가로형) → 테이블 → 안내 문구 순.
// 테이블을 최대한 크게 그리려고 위쪽 공간이 좁아서, 사용자 정보 카드는 아바타를 왼쪽, 아이디/별명/승율을 오른쪽에 둔
// 가로로 긴 카드로 나란히 둔다(다른 게임의 세로 카드를 줄이면 글자가 너무 작아진다).
const HEADER_CARD_WIDTH = 312;
const HEADER_CARD_HEIGHT = 160;
const HEADER_AVATAR_SIZE = 116;
// 카드 안쪽 여백 — 아바타는 왼쪽 위에서 이만큼 띄운다(위쪽은 "상대"/"나" 이름표 자리까지 감안).
const HEADER_PADDING_X = 16;
const HEADER_PADDING_Y = 26;
const CARD_GAP = 64;
const PANEL_Y = 96;
const TABLE_Y = 290;
// 점수판 — 테이블 오른쪽 바깥, 중앙선 위(상대)/아래(나)에 하나씩.
const SCORE_BADGE_SIZE = 72;
const SCORE_OFFSET_Y = 80;
// 가로 카드 안 글자 영역 폭 = 카드 폭 - 양쪽 여백 - 아바타 - 아바타와 글자 사이(14) - 명칭 칸(약 60).
const HEADER_PANEL_LAYOUT = {
  horizontal: true,
  avatar_size: HEADER_AVATAR_SIZE,
  font_size: 19,
  value_max_width: HEADER_CARD_WIDTH - HEADER_PADDING_X * 2 - HEADER_AVATAR_SIZE - 14 - 60,
} as const;

export interface AirhockeySceneOptions {
  room: Room;
  // player1/player2 중 내 쪽을 구분하기 위한 값.
  my_userid: string;
  // REJOIN_GAME 으로 들어온 경우 true — 이미 판이 진행 중이므로 '게임 준비' 버튼을 보여주지 않는다.
  is_rejoin: boolean;
  notice_banner: NoticeBanner;
  // 로비로 돌아갈 때 새 로비 씬을 만들기 위한 콜백.
  onExitToLobby: () => void;
}

export class AirhockeyScene implements Scene {
  readonly view = new Container();

  private readonly status: Text;
  private readonly rejoin_notice: Text;
  private readonly title_text: Text;
  private readonly vs_text: Text;
  // 사용자 정보 카드 + 패널(가로 배치)을 묶은 것.
  private readonly opponent_header = new Container();
  private readonly my_header = new Container();
  private readonly opponent_panel = new PlayerPanel(CUTE_THEME, HEADER_PANEL_LAYOUT);
  private readonly my_panel = new PlayerPanel(CUTE_THEME, HEADER_PANEL_LAYOUT);
  private readonly table: AirhockeyTable;
  private readonly opponent_score_text: Text;
  private readonly my_score_text: Text;
  private readonly score_board = new Container();
  // 최종 결과(GAME_RESULT) 때 테이블 가운데에 나타나 승자 별명을 쓴 플랜카드를 드는 오리 캐릭터.
  private readonly duck = new DuckMascot();
  private readonly confetti = new Confetti();
  private readonly ready_button: Button;
  private readonly game_start_banner = new GameStartBanner(CUTE_THEME);
  // SERVE_SELECT 때 첫 서브 유저를 보여주는 동전 던지기 연출. GAME_START 가 오면 내린다.
  private readonly coin_toss = new AirhockeyCoinToss();
  private readonly result_popup: GameResultPopup;
  private readonly back_to_lobby_button: Button;
  private readonly connection_lost_popup: ConnectionLostPopup;
  private readonly connection: AirhockeyConnection;
  private readonly options: AirhockeySceneOptions;
  // ENTER_ROOM 때 정해진다 — GAME_STATUS 의 LEVER0/LEVER1, win_count0/1 중 어느 쪽이 나인지 구분한다.
  private is_player1_me = true;
  private opponent_userid = "";
  // GAME_RESULT 는 userid 만 주므로, 최종 결과 플랜카드에 쓸 별명을 ENTER_ROOM 때 기억해 둔다.
  private my_name = "";
  private opponent_name = "";
  private my_goals = 0;
  private opponent_goals = 0;
  // 지금 판(아직 판 전이면 첫 판)의 서브 유저 — SERVE_SELECT / ONE_START / GAME_STATUS 로 받는다. 퍽 시작 자리를 정한다.
  private serve_userid = "";
  // '재시작'을 눌러서 응답을 기다리는 중인지 — 이 상태에서 OUT_USER 를 받으면 새 상대를 기다리는 상태로 넘어간다.
  private has_requested_replay = false;
  // 결과 화면에서 내가 재시작/나가기를 고르기 전에 상대가 먼저 나간 경우.
  private opponent_left_at_result = false;
  // '나가기'를 눌러서 스스로 끊는 중인지 — 아니면 onLeave 는 예기치 않은 오류로 취급한다.
  private exit_requested = false;
  // RETURN_TO_LOBBY 와 onLeave(CONSENTED) 가 같은 상황에서 둘 다 올 수 있어, 로비 전환은 한 번만 한다.
  private returned_to_lobby = false;
  private banner_timer: ReturnType<typeof setTimeout> | null = null;
  private round_message_timer: ReturnType<typeof setTimeout> | null = null;
  // 재접속 안내를 5초 뒤에 지우는 타이머.
  private rejoin_notice_timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AirhockeySceneOptions) {
    this.options = options;
    this.connection = new AirhockeyConnection(options.room);

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

    this.title_text = new Text({
      text: "에어하키!",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 40,
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
        fontSize: 40,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 8, join: "round" },
      },
    });
    this.vs_text.anchor.set(0.5);

    for (const [header, tag, color, panel] of [
      [this.opponent_header, "상대", CUTE_COLOR.shirt_dark, this.opponent_panel],
      [this.my_header, "나", CUTE_COLOR.orange, this.my_panel],
    ] as const) {
      panel.position.set(HEADER_PADDING_X, HEADER_PADDING_Y);
      header.addChild(CreatePlayerCard(tag, color, HEADER_CARD_WIDTH, HEADER_CARD_HEIGHT), panel);
    }

    this.table = new AirhockeyTable({ onLeverMove: (loc) => this.OnLeverMove(loc) });

    this.opponent_score_text = CreateScoreText(CUTE_COLOR.shirt_dark);
    this.my_score_text = CreateScoreText(CUTE_COLOR.orange);
    this.score_board.addChild(
      CreateScoreBadge(CUTE_COLOR.shirt_dark, "상대", -SCORE_OFFSET_Y, this.opponent_score_text),
      CreateScoreBadge(CUTE_COLOR.orange, "나", SCORE_OFFSET_Y, this.my_score_text)
    );

    this.duck.visible = false;

    this.ready_button = new Button({
      label: "게임 준비",
      width: 360,
      height: 84,
      theme: CUTE_THEME,
      onClick: () => this.OnClickReady(),
    });
    this.ready_button.SetEnabled(false);
    this.ready_button.visible = false;

    this.result_popup = new GameResultPopup({
      onReplay: () => this.OnClickReplay(),
      onExit: () => this.OnClickExit(),
      theme: CUTE_THEME,
      // 테이블 가운데 오리(승자 플랜카드)가 보이도록 작게 만들어 오리 발 아래에 띄우고, 뒤 게임 화면은 옅은 검정으로 덮어 결과 화면과 분리한다.
      layout: { panel_width: 520, panel_height: 290, panel_y: 940, button_height: 56, dim_alpha: RESULT_SCREEN_DIM_ALPHA },
    });

    this.back_to_lobby_button = new Button({
      label: "로비로 돌아가기",
      width: 360,
      height: 84,
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
      this.opponent_header,
      this.my_header,
      this.vs_text,
      this.table,
      this.score_board,
      this.status,
      this.rejoin_notice,
      this.ready_button,
      this.result_popup,
      // 결과 팝업의 옅은 덮개보다 위에 둬서 오리가 흐려지지 않게 한다.
      this.duck,
      this.back_to_lobby_button,
      this.confetti,
      this.coin_toss,
      this.game_start_banner,
      this.connection_lost_popup
    );
    this.ResetPlayState();
    this.table.SetMessage("준비 중");

    this.connection.Listen({
      onEnterRoom: (envelope) => this.HandleEnterRoom(envelope.payload),
      onOutUser: (envelope) => this.HandleOutUser(envelope.payload),
      onServeSelect: (envelope) => this.HandleServeSelect(envelope.payload),
      onGameStart: () => this.HandleGameStart(),
      onOneStart: (envelope) => this.HandleOneStart(envelope.payload),
      onPuckMove: (envelope) => this.table.SetPuck(envelope.payload.loc),
      onLeverMove: (envelope) => this.HandleLeverMove(envelope.payload),
      onOneResult: (envelope) => this.HandleOneResult(envelope.payload),
      onGameStatus: (envelope) => this.HandleGameStatus(envelope.payload),
      onGameResult: (envelope) => this.HandleGameResult(envelope.payload),
      onReturnToLobby: () => this.GoToLobbyOnce(),
      onOpponentJoined: (envelope) => this.HandleOpponentJoined(envelope.payload),
      onNotice: (envelope) => this.options.notice_banner.Show(envelope.payload.message),
      onLeave: (code) => this.HandleLeave(code),
    });

    this.connection.SendEnterRoom();
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "ENTER_ROOM" })}`);
  }

  public Resize(width: number, _height: number): void {
    const center_x = width / 2;
    const header_width = HEADER_CARD_WIDTH;
    const table_x = center_x - TABLE_SCREEN_WIDTH / 2;
    const table_center_y = TABLE_Y + TABLE_SCREEN_HEIGHT / 2;

    this.title_text.position.set(center_x, 6);
    this.opponent_header.position.set(center_x - CARD_GAP / 2 - header_width, PANEL_Y);
    this.my_header.position.set(center_x + CARD_GAP / 2, PANEL_Y);
    this.vs_text.position.set(center_x, PANEL_Y + HEADER_CARD_HEIGHT / 2);
    this.table.position.set(table_x, TABLE_Y);
    // 점수판은 테이블 오른쪽 벽과 화면 끝 사이 가운데.
    const table_right = table_x + TABLE_SCREEN_WIDTH + WALL_THICKNESS;
    this.score_board.position.set((table_right + width) / 2, table_center_y);
    // 준비/로비 버튼은 테이블의 내 쪽 절반 가운데에 띄운다(게임 전/후에는 테이블을 쓰지 않는다).
    const button_y = table_center_y + TABLE_SCREEN_HEIGHT / 4 - this.ready_button.height / 2;
    // 게임 준비 버튼은 테이블 직사각형의 정가운데(중앙선 위)에 둔다 — 게임 전에는 퍽이 가운데에 멈춰 있어 가려도 된다.
    this.ready_button.position.set(center_x - this.ready_button.width / 2, table_center_y - this.ready_button.height / 2);
    this.back_to_lobby_button.position.set(center_x - this.back_to_lobby_button.width / 2, button_y);
    // 오리는 발 가운데가 기준점이라, 몸통이 테이블 한가운데에 오도록 발을 가운데보다 조금 아래에 둔다.
    this.duck.position.set(center_x, table_center_y + 110);
    this.coin_toss.SetCenter(center_x, table_center_y);
    this.status.position.set(center_x, TABLE_Y + TABLE_SCREEN_HEIGHT + WALL_THICKNESS + 8);
    this.rejoin_notice.position.set(center_x, TABLE_Y + TABLE_SCREEN_HEIGHT + WALL_THICKNESS + 38);
  }

  public Destroy(): void {
    // '로비로 돌아가기'는 방을 나가지 않고 화면만 바꾸므로, 이후 오는 게임 채널 메시지가 파괴된 씬을 건드리지 않게 콜백을 끊는다.
    this.connection.Dispose();
    if (this.banner_timer) clearTimeout(this.banner_timer);
    if (this.round_message_timer) clearTimeout(this.round_message_timer);
    if (this.rejoin_notice_timer) clearTimeout(this.rejoin_notice_timer);
    this.view.destroy({ children: true });
  }

  // player1/player2 중 어느 쪽이 나인지 표시가 없어 userid 로 직접 구분한다.
  private HandleEnterRoom(payload: EnterRoomPayload): void {
    this.is_player1_me = payload.player1.userid === this.options.my_userid;
    const me = this.is_player1_me ? payload.player1 : payload.player2;
    const opponent = this.is_player1_me ? payload.player2 : payload.player1;

    this.opponent_panel.SetInfo(opponent);
    this.my_panel.SetInfo(me);
    this.opponent_userid = opponent.userid;
    this.my_name = me.name;
    this.opponent_name = opponent.name;
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
    this.table.SetMessage("");
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
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "ENTER_ROOM" })}`);
  }

  private OnClickReady(): void {
    this.connection.SendReady({ ready: "Y" });
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "READY", payload: { ready: "Y" } })}`);
    this.ready_button.SetEnabled(false);
    this.status.text = "상대의 준비를 기다리는 중...";
  }

  // 양쪽 READY(또는 둘 다 재시작) 직후 — 서버가 동전 던지기로 정한 첫 서브 유저. 5초 뒤 GAME_START 가 온다.
  // 테이블을 처음 상태로 깔고(퍽은 서브 쪽) 동전 던지기 연출을 띄운다. 동전에는 서브 유저의 별명을 쓴다.
  private HandleServeSelect(payload: AirhockeyServeSelectPayload): void {
    this.has_requested_replay = false;
    this.opponent_left_at_result = false;
    this.ready_button.visible = false;
    this.back_to_lobby_button.visible = false;
    this.result_popup.Hide();
    this.HideRejoinNotice();

    this.serve_userid = payload.userid;
    this.ResetPlayState();
    this.status.text = "동전 던지기로 먼저 서브할 사람을 정해요!";

    const me = { name: this.my_name || "나", color: CUTE_COLOR.orange };
    const opponent = { name: this.opponent_name || "상대", color: CUTE_COLOR.shirt_dark };
    const is_my_serve = this.IsMyServe();
    this.coin_toss.Play(is_my_serve ? opponent : me, is_my_serve ? me : opponent);
  }

  // 동전 던지기 5초 뒤 — 테이블을 처음 상태로 깔고 레버를 움직일 수 있게 한다.
  // 퍽은 3초 뒤 ONE_START 부터 움직인다(그 전에도 레버는 서버가 받아 상대 화면에 보여준다).
  private HandleGameStart(): void {
    this.has_requested_replay = false;
    this.opponent_left_at_result = false;
    this.ready_button.visible = false;
    this.back_to_lobby_button.visible = false;
    this.result_popup.Hide();
    this.HideRejoinNotice();
    this.coin_toss.Hide();

    this.ResetPlayState();
    this.table.SetPlayable(true);
    this.table.SetMessage("곧 시작합니다!");
    this.status.text = `레버를 끌어서 퍽을 상대 골대에 넣으세요! (${AIRHOCKEY_WIN_GOALS}골 먼저 넣으면 승리)`;

    if (this.banner_timer) clearTimeout(this.banner_timer);
    this.game_start_banner.Show();
    this.banner_timer = setTimeout(() => this.HideGameStartBanner(), GAME_START_BANNER_DURATION_MS);
  }

  // 한 판(한 골) 시작 — 퍽이 서브할 유저(serve) 쪽에 멈춘 채로 놓인다. 받는 쪽 레버는 중앙선을 못 넘어 먼저 칠 수 없다.
  // 레버는 가운데 위/아래 시작 자리로 옮기고, 내 레버를 다시 잡아야 움직인다(AirhockeyTable.PlaceForRoundStart).
  private HandleOneStart(payload: AirhockeyOneStartPayload): void {
    this.HideGameStartBanner();
    this.coin_toss.Hide();
    this.serve_userid = payload.serve;
    this.table.HideGoalText();
    this.table.PlaceForRoundStart(this.IsMyServe());
    this.table.SetPlayable(true);
    this.ShowRoundMessage(this.IsMyServe() ? "내 서브!" : "상대 서브!");
  }

  private IsMyServe(): boolean {
    return this.serve_userid === this.options.my_userid;
  }

  private HandleLeverMove(payload: AirhockeyLeverMoveResultPayload): void {
    // 내 레버 위치는 서버가 보내지 않지만(주인에게는 안 보냄), 혹시 오더라도 손가락 위치를 우선한다.
    if (payload.user === this.options.my_userid) return;
    // 상대가 바뀌는 중(새 상대 대기)에 늦게 온 이전 상대의 레버는 무시한다.
    if (this.opponent_userid !== "" && payload.user !== this.opponent_userid) return;
    this.table.SetOpponentLever(payload.loc);
  }

  // 내 레버를 움직였다 — 초당 수십 번이라 콘솔에는 남기지 않는다(AirhockeyConnection.SendLeverMove 주석 참고).
  private OnLeverMove(loc: AirhockeyPoint): void {
    this.connection.SendLeverMove({ loc });
  }

  // 골! win 은 골을 넣은 유저, win_count 는 그 유저의 누적 골 수(서버 기준이라 그대로 덮어쓴다).
  private HandleOneResult(payload: AirhockeyOneResultPayload): void {
    const is_my_goal = payload.win === this.options.my_userid;
    if (is_my_goal) this.my_goals = payload.win_count;
    else this.opponent_goals = payload.win_count;
    this.UpdateScore();
    this.ClearRoundMessage();

    if (is_my_goal) {
      this.table.ShowGoalText("골인!", CUTE_COLOR.orange);
      this.confetti.Play();
    } else {
      this.table.ShowGoalText("실점...", CUTE_COLOR.shirt_dark);
    }
    // 마지막 골이면 서버가 3초 뒤 GAME_RESULT 를 보낸다 — 그동안 레버는 계속 움직일 수 있다.
    const is_last_goal = payload.win_count >= AIRHOCKEY_WIN_GOALS;
    this.table.SetMessage(is_last_goal ? "경기 종료!" : "곧 다음 판이 시작돼요");
  }

  // 게임 중 재접속 — 서버가 재접속 당사자에게만 보내는 현재 상태로 퍽/레버 위치와 점수를 복원한다.
  private HandleGameStatus(payload: AirhockeyGameStatusPayload): void {
    this.ready_button.visible = false;
    // 재접속 안내("별명님 재접속했습니다.")는 여기서 지우지 않는다 — 5초 타이머가 지운다.
    if (payload.serve !== undefined) this.serve_userid = payload.serve;
    const my_lever = this.is_player1_me ? payload.LEVER0 : payload.LEVER1;
    const opponent_lever = this.is_player1_me ? payload.LEVER1 : payload.LEVER0;
    this.table.SnapPuck(payload.puck.loc);
    this.table.SetMyLever(my_lever);
    this.table.SetOpponentLever(opponent_lever, true);
    if (payload.win_count0 !== undefined && payload.win_count1 !== undefined) {
      this.my_goals = this.is_player1_me ? payload.win_count0 : payload.win_count1;
      this.opponent_goals = this.is_player1_me ? payload.win_count1 : payload.win_count0;
      this.UpdateScore();
    }
    this.table.SetPlayable(true);
    this.table.SetMessage("");
    this.status.text = "이어서 경기하세요!";
  }

  // 최종 결과 — win_count 는 넣은 골 수, score 는 이번 게임 랭킹 점수(골 수 × 5). draw:"Y" 면 무승부.
  // 퍽 정체로 게임이 중단된 경우도 draw:"Y" 로 온다(GAME_INVALID 폐지) — 승자 없이 무승부 화면 + 재시작/나가기 선택.
  private HandleGameResult(payload: AirhockeyGameResultPayload): void {
    const am_i_winner = payload.winner.userid === this.options.my_userid;
    const me = am_i_winner ? payload.winner : payload.loser;
    const opponent = am_i_winner ? payload.loser : payload.winner;
    const is_draw = payload.draw === "Y";

    // ENTER_ROOM 때 보여준 사용자 정보 뷰의 win_per 를 최신 값으로 갱신한다.
    this.my_panel.UpdateWinPer(me.win_per);
    this.opponent_panel.UpdateWinPer(opponent.win_per);
    this.my_goals = me.win_count;
    this.opponent_goals = opponent.win_count;
    this.UpdateScore();

    this.StopPlayUi();
    this.table.SetMessage("");
    this.ShowFinalDuck(am_i_winner, is_draw, payload.winner.userid);
    // 승패는 오리 머리 위 문구로 이미 보여주므로 팝업에는 골 수/점수만 쓴다.
    this.result_popup.Show(`나: ${me.win_count}골 · ${me.score}점\n상대: ${opponent.win_count}골 · ${opponent.score}점`);
  }

  private OnClickReplay(): void {
    this.has_requested_replay = true;
    this.connection.SendReplay({ replay: "Y" });
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "GAME_RESULT", payload: { replay: "Y" } })}`);

    // 재시작을 고르면 이전 판 화면을 바로 비운다(새 판은 SERVE_SELECT 에서 처음 상태로 시작한다).
    // 첫 서브는 새로 정해지므로(같은 상대면 교대, 새 상대면 동전 던지기) 이전 서브 유저는 잊는다 — 퍽은 가운데.
    this.serve_userid = "";
    this.ResetPlayState();

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

  // 테이블 가운데에 오리를 띄워 승자 별명을 쓴 플랜카드를 들게 하고 색종이를 뿌린다.
  private ShowFinalDuck(am_i_winner: boolean, is_draw: boolean, winner_userid: string): void {
    this.duck.visible = true;
    if (is_draw) {
      this.duck.ShowFinalResult(`${this.my_name || "나"} & ${this.opponent_name || "상대"}`, "무승부", CUTE_COLOR.brown, "DRAW");
    } else {
      const winner_name = (am_i_winner ? this.my_name : this.opponent_name) || winner_userid;
      // 에어하키는 3골 한 경기로 끝나므로 "최종" 없이 승리/패배만 쓴다.
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

  // 새 경기 상태로 되돌린다 — 점수 0:0, 퍽은 가운데(첫 서브 유저를 알면 그 쪽 서브 자리), 레버는 각자 골대 앞.
  private ResetPlayState(): void {
    this.HideFinalDuck();
    this.table.SetPlayable(false);
    this.table.ResetPositions();
    if (this.serve_userid !== "") this.table.PlaceServePuck(this.IsMyServe());
    this.table.SetMessage("");
    this.ClearRoundMessage();
    this.my_goals = 0;
    this.opponent_goals = 0;
    this.UpdateScore();
  }

  // 경기 진행 중에만 의미 있는 UI(조작/연출 배너)를 모두 끈다 — 테이블 위 퍽/레버 위치는 그대로 둔다.
  private StopPlayUi(): void {
    this.table.SetPlayable(false);
    this.table.HideGoalText();
    this.ClearRoundMessage();
    this.HideGameStartBanner();
    this.coin_toss.Hide();
    this.HideFinalDuck();
  }

  private HideGameStartBanner(): void {
    if (this.banner_timer) {
      clearTimeout(this.banner_timer);
      this.banner_timer = null;
    }
    this.game_start_banner.Hide();
  }

  // 테이블 안내 문구를 잠깐 보여주고 지운다.
  private ShowRoundMessage(message: string): void {
    this.ClearRoundMessage();
    this.table.SetMessage(message);
    this.round_message_timer = setTimeout(() => {
      this.round_message_timer = null;
      this.table.SetMessage("");
    }, ROUND_START_MESSAGE_MS);
  }

  private ClearRoundMessage(): void {
    if (!this.round_message_timer) return;
    clearTimeout(this.round_message_timer);
    this.round_message_timer = null;
    this.table.SetMessage("");
  }

  private UpdateScore(): void {
    this.my_score_text.text = String(this.my_goals);
    this.opponent_score_text.text = String(this.opponent_goals);
  }
}

function CreateScoreText(color: number): Text {
  const text = new Text({
    text: "0",
    style: { fill: color, fontSize: 44, fontFamily: CUTE_FONT_FAMILY, stroke: { color: 0xffffff, width: 6, join: "round" } },
  });
  text.anchor.set(0.5);
  return text;
}

// 점수 배지 — 동그란 크림색 바탕 + 이름표("상대"/"나") + 골 수. offset_y 는 점수판 가운데(중앙선) 기준 세로 위치.
function CreateScoreBadge(color: number, tag: string, offset_y: number, score_text: Text): Container {
  const badge = new Container();
  const radius = SCORE_BADGE_SIZE / 2;
  const background = new Graphics()
    .circle(0, 4, radius)
    .fill({ color: 0x000000, alpha: 0.1 })
    .circle(0, 0, radius)
    .fill(CUTE_COLOR.cream)
    .stroke({ color, width: 5 });
  const tag_text = new Text({
    text: tag,
    style: { fill: color, fontSize: 18, fontFamily: CUTE_FONT_FAMILY, stroke: { color: 0xffffff, width: 4, join: "round" } },
  });
  tag_text.anchor.set(0.5);
  // 이름표는 상대 배지는 위쪽, 내 배지는 아래쪽(중앙선 바깥쪽)에 붙인다.
  tag_text.position.set(0, offset_y < 0 ? -radius - 16 : radius + 16);
  badge.addChild(background, score_text, tag_text);
  badge.position.set(0, offset_y);
  return badge;
}
