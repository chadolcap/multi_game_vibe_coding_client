// 로비 씬 — 씬이 뜨면 버튼 없이 바로 로비 소켓에 접속하고, 연결되면 바로 ENTER_LOBBY 를 보낸다.
// 소켓 연결에 실패하거나 끊어지면 팝업으로 알리고, '로비로 접속' 버튼으로 다시 접속하게 한다.
// 응답의 name 이 비어 있으면 별명 등록 팝업을 띄운다. 다 끝나면 '내정보 보기' / '게임 참여' 버튼만 남긴다.
// 통신 내용은 화면에 노출하지 않고 콘솔에만 출력한다.
import { Container, Graphics, Text, Ticker } from "pixi.js";
import { CloseCode, type Room } from "@colyseus/sdk";
import type { Scene } from "./Scene";
import { Button } from "../ui/Button";
import { NicknamePopup } from "../ui/NicknamePopup";
import { InfoPopup } from "../ui/InfoPopup";
import { ConnectionLostPopup } from "../ui/ConnectionLostPopup";
import { GameSelect, GetGameLabel, SELECT_WIDTH } from "../ui/GameSelect";
import { CUTE_COLOR, CUTE_FONT_FAMILY, CUTE_THEME, CreateCuteBackground } from "../ui/CuteTheme";
import { GAME_WIDTH } from "../config";
import { DuckMascot } from "../ui/DuckMascot";
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

// AD_VIEW_COMPLETE 실패(error) 코드 — 1=30초 안에 다시 보냄, 2=서버 오류. 둘 다 같은 안내를 한다(서버 docs/HANDOFF.md).
const AD_VIEW_ERROR_MESSAGE = "잠시 후 다시 시도해 주세요.";

const LOG_TAG = "[Lobby]";

// 화면 세로 배치(720x1280 기준). 타이틀 → 오리 → 메뉴 카드(게임 선택 + 버튼) → 상태 문구 순.
const TITLE_Y = 70;
// 오리는 발 가운데가 기준점이다.
const DUCK_FEET_Y = 500;
const MENU_CARD_WIDTH = 540;
const MENU_CARD_Y = 520;
const MENU_CARD_HEIGHT = 460;
// 메인 메뉴가 떠 있을 때는 상태 문구(매칭 중 등)를 카드 아래에, 접속 중처럼 메뉴가 없을 때는 빈 카드 가운데에 둔다.
const STATUS_Y_WITH_MENU = 1010;
const STATUS_Y_WITHOUT_MENU = MENU_CARD_Y + MENU_CARD_HEIGHT / 2 - 20;
// 상태 문구가 카드 가운데에 놓일 때 카드 테두리를 넘지 않도록 좌우 여백을 둔 줄바꿈 폭.
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
  onGameRoomReady: (handoff: GameHandoff) => void;
}

export class LobbyScene implements Scene {
  readonly view = new Container();

  private readonly status: Text;
  private readonly title_text: Text;
  private readonly subtitle_text: Text;
  // 게임 화면과 같은 컨셉의 오리 캐릭터 — 로비에서는 제자리에서 통통 튀기만 한다.
  private readonly duck = new DuckMascot();
  // 게임 선택 + 버튼을 올려 두는 크림색 카드.
  private readonly menu_card: Graphics;
  // 화면 가로 중앙 — Resize() 가 갱신하며, 그 전에는 디자인 해상도 기준 값을 쓴다.
  private center_x = GAME_WIDTH / 2;
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

    this.title_text = new Text({
      text: "멀티 게임!",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 64,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 11, join: "round" },
        dropShadow: { color: CUTE_COLOR.orange_dark, alpha: 0.5, distance: 5, angle: Math.PI / 2, blur: 0 },
      },
    });
    this.title_text.anchor.set(0.5, 0);

    this.subtitle_text = new Text({
      text: "게임을 골라 친구와 대결해요",
      style: {
        fill: CUTE_COLOR.shirt_dark,
        fontSize: 22,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 6, join: "round" },
      },
    });
    this.subtitle_text.anchor.set(0.5, 0);

    // 로비 오리는 깃발 없이 통통 튀기만 한다.
    this.duck.HideFlags();

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
    this.my_info_button.visible = false;
    this.join_match_button.visible = false;
    this.cancel_match_button.visible = false;
    this.rank_daily_button.visible = false;
    this.rank_weekly_button.visible = false;

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

    this.view.addChild(
      CreateCuteBackground(),
      this.title_text,
      this.subtitle_text,
      this.duck,
      this.menu_card,
      this.status,
      this.game_select,
      this.my_info_button,
      this.join_match_button,
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
    this.center_x = center_x;

    this.title_text.position.set(center_x, TITLE_Y);
    this.subtitle_text.position.set(center_x, TITLE_Y + 92);
    this.duck.position.set(center_x, DUCK_FEET_Y);
    this.menu_card.position.set(center_x - MENU_CARD_WIDTH / 2, MENU_CARD_Y);

    this.status.anchor.set(0.5, 0);
    this.UpdateStatusPosition();

    this.game_select.position.set(center_x - SELECT_WIDTH / 2, MENU_CARD_Y + 44);

    this.my_info_button.position.set(center_x - this.my_info_button.width / 2, MENU_CARD_Y + 136);
    this.join_match_button.position.set(center_x - this.join_match_button.width / 2, MENU_CARD_Y + 246);
    this.cancel_match_button.position.set(center_x - this.cancel_match_button.width / 2, MENU_CARD_Y + 246);

    const rank_gap = 20;
    const rank_row_width = this.rank_daily_button.width + rank_gap + this.rank_weekly_button.width;
    const rank_row_x = center_x - rank_row_width / 2;
    this.rank_daily_button.position.set(rank_row_x, MENU_CARD_Y + 356);
    this.rank_weekly_button.position.set(rank_row_x + this.rank_daily_button.width + rank_gap, MENU_CARD_Y + 356);

    this.star_text.position.set(STAR_ROW_X, STAR_ROW_Y + STAR_ROW_HEIGHT / 2);
    this.ad_button.position.set(AD_BUTTON_X, STAR_ROW_Y);
  }

  // 메인 메뉴가 있으면 카드 아래, 없으면(접속 중 등) 빈 카드 가운데에 상태 문구를 둔다.
  // 메인 메뉴가 떠 있는지는 따로 플래그를 두지 않고 항상 보이는 '내정보 보기' 버튼으로 판단한다.
  private UpdateStatusPosition(): void {
    const is_main_ui_shown = this.my_info_button.visible;
    this.status.position.set(this.center_x, is_main_ui_shown ? STATUS_Y_WITH_MENU : STATUS_Y_WITHOUT_MENU);
  }

  public Destroy(): void {
    // 게임 씬으로 넘어간 뒤 늦게 도착한 로비 종료 이벤트가 파괴된 씬이나 전역 로딩 오버레이를 건드리지 않게 콜백을 끊는다.
    this.connection.Dispose();
    this.nickname_popup.DestroyPopup();
    this.game_select.DestroySelect();
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
    this.my_info_button.visible = false;
    this.join_match_button.visible = false;
    this.cancel_match_button.visible = false;
    this.rank_daily_button.visible = false;
    this.rank_weekly_button.visible = false;
    this.star_text.visible = false;
    this.ad_button.visible = false;
    this.game_select.Hide();
    this.UpdateStatusPosition();
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
    this.my_info_button.visible = true;
    this.join_match_button.visible = true;
    this.rank_daily_button.visible = true;
    this.rank_weekly_button.visible = true;
    this.star_text.visible = true;
    this.ad_button.visible = true;
    this.ad_button.SetEnabled(true);
    this.game_select.Show();
    this.UpdateStatusPosition();
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
    const payload = { game: this.game_select.GetSelectedGame(), select: "Y" as const };
    this.connection.SendJoinMatch(payload);
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "JOIN_MATCH", payload })}`);
    // MATCH_FOUND 는 다른 유저가 매칭될 때까지 즉시 오지 않으므로, 그때까지 취소할 수 있게 한다.
    this.status.visible = true;
    this.SetStatus("상대를 찾는 중...");
    this.ShowCancelMatchButton();
  }

  private OnClickCancelMatch(): void {
    const payload = { game: this.game_select.GetSelectedGame(), select: "N" as const };
    this.connection.SendJoinMatch(payload);
    console.log(`${LOG_TAG} C -> S ${JSON.stringify({ type: "JOIN_MATCH", payload })}`);
    this.SetStatus("매칭을 취소했습니다.");
    this.ShowJoinMatchButton();
  }

  private ShowJoinMatchButton(): void {
    this.join_match_button.visible = true;
    this.join_match_button.SetEnabled(true);
    this.cancel_match_button.visible = false;
  }

  private ShowCancelMatchButton(): void {
    this.join_match_button.visible = false;
    this.cancel_match_button.visible = true;
    this.cancel_match_button.SetEnabled(true);
  }

  // 매칭 성사 — seat_reservation 으로 게임 채널에 새로 접속한다.
  // 이 시점에 서버가 로비 연결을 스스로 끊으므로(CONSENTED), 그건 onLeave 에서 정상 흐름으로 처리한다.
  private async HandleMatchFound(payload: MatchFoundPayload): Promise<void> {
    // 매칭이 성사됐으니 더 이상 취소할 수 없다.
    this.cancel_match_button.visible = false;
    // 혼자 하는 게임(청기백기)은 opponent 가 오지 않는다.
    const opponent_text = payload.opponent ? ` 상대: ${payload.opponent.name || "(이름 없음)"} —` : "";
    this.options.loading_overlay.Show(`매칭 완료!${opponent_text} 게임 채널 접속 중...`);

    try {
      const game_room = await this.connection.ConsumeMatchSeat(payload.seat_reservation);
      console.log(`${LOG_TAG} 게임 채널 접속 완료 roomId=${game_room.roomId} sessionId=${game_room.sessionId}`);
      // 게임 종류는 방 이름(othello_1 등)이 가장 정확하다. 못 뽑으면 내가 로비에서 선택해 둔 게임을 쓴다.
      const game = ParseGameIdFromRoomName(payload.room_name) ?? this.game_select.GetSelectedGame();
      this.options.onGameRoomReady({ room: game_room, game, my_userid: this.my_userid, is_rejoin: false });
    } catch (error) {
      console.error(`${LOG_TAG} 게임 채널 접속 실패 ${error instanceof Error ? error.message : String(error)}`);
      this.options.loading_overlay.Hide();

      if (this.connection.IsConnected()) {
        // 로비 연결이 아직 살아있으면 그대로 다시 '게임 참여'를 누를 수 있게 한다.
        this.SetStatus("게임 채널 접속 실패 (콘솔 확인) — 다시 시도해 주세요.");
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

  private SetStar(star: number): void {
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
