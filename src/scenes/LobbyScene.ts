// 로비 씬 — 씬이 뜨면 버튼 없이 바로 로비 소켓에 접속하고, 연결되면 바로 ENTER_LOBBY 를 보낸다.
// 소켓 연결에 실패하면 "연결이 안됩니다" 상태 메시지만 보여준다(재시도 버튼 없음).
// 응답의 name 이 비어 있으면 별명 등록 팝업을 띄운다. 다 끝나면 '내정보 보기' / '게임 참여' 버튼만 남긴다.
// 통신 내용은 화면에 노출하지 않고 콘솔에만 출력한다.
import { Container, Text } from "pixi.js";
import { CloseCode, type Room } from "@colyseus/sdk";
import type { Scene } from "./Scene";
import { Button } from "../ui/Button";
import { NicknamePopup } from "../ui/NicknamePopup";
import { InfoPopup } from "../ui/InfoPopup";
import { GameSelect, SELECT_WIDTH } from "../ui/GameSelect";
import type { LoadingOverlay } from "../ui/LoadingOverlay";
import type { NoticeBanner } from "../ui/NoticeBanner";
import { LobbyConnection } from "../network/LobbyConnection";
import { GetQueryParam } from "../common/urlParams";
import { ParseGameIdFromRoomName } from "../common/channelNames";
import {
  GameId,
  type EnterLobbyPayload,
  type EnterLobbyResultPayload,
  type MatchFoundPayload,
  type NameResultPayload,
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

const LOG_TAG = "[Lobby]";

// 서버 응답 객체를 "key: value" 줄글로 바꿔서 팝업에 그대로 보여준다.
function FormatPayload(payload: unknown): string {
  if (payload === null || typeof payload !== "object") return String(payload);
  return Object.entries(payload as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join("\n");
}

// RANK_DAILY/RANK_WEEKLY 의 list([별명, 점수] 튜플 배열)와 내 순위를 팝업용 줄글로 바꾼다.
function FormatRankList(list: RankEntry[], my: MyRankInfo): string {
  const lines = list.map(([name, score], index) => `${index + 1}위  ${name}  ${score}점`);
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
  private readonly nickname_popup = new NicknamePopup();
  private readonly info_popup = new InfoPopup();
  private readonly game_select = new GameSelect();
  private game_select_hidden_by_popup = false;
  private readonly my_info_button: Button;
  private readonly join_match_button: Button;
  private readonly cancel_match_button: Button;
  private readonly rank_daily_button: Button;
  private readonly rank_weekly_button: Button;
  private readonly connection = new LobbyConnection();
  private readonly options: LobbySceneOptions;
  private my_userid = "";

  constructor(options: LobbySceneOptions) {
    this.options = options;
    this.status = new Text({
      text: "대기 중",
      style: {
        fill: 0xcccccc,
        fontSize: 24,
        fontFamily: "sans-serif",
        wordWrap: true,
        wordWrapWidth: 600,
        align: "center",
      },
    });

    this.my_info_button = new Button({ label: "내정보 보기", width: 440, height: 88, onClick: () => this.OnClickMyInfo() });
    this.join_match_button = new Button({ label: "게임 참여", width: 440, height: 88, onClick: () => this.OnClickJoinMatch() });
    this.cancel_match_button = new Button({
      label: "매칭 취소",
      width: 440,
      height: 88,
      onClick: () => this.OnClickCancelMatch(),
    });
    this.rank_daily_button = new Button({
      label: "일간 랭킹",
      width: 210,
      height: 88,
      onClick: () => this.OnClickRankDaily(),
    });
    this.rank_weekly_button = new Button({
      label: "주간 랭킹",
      width: 210,
      height: 88,
      onClick: () => this.OnClickRankWeekly(),
    });
    this.my_info_button.visible = false;
    this.join_match_button.visible = false;
    this.cancel_match_button.visible = false;
    this.rank_daily_button.visible = false;
    this.rank_weekly_button.visible = false;

    this.view.addChild(
      this.status,
      this.game_select,
      this.my_info_button,
      this.join_match_button,
      this.cancel_match_button,
      this.rank_daily_button,
      this.rank_weekly_button,
      this.nickname_popup,
      this.info_popup
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

    this.status.anchor.set(0.5, 0);
    this.status.position.set(center_x, 300);

    this.game_select.position.set(center_x - SELECT_WIDTH / 2, 490);

    this.my_info_button.position.set(center_x - this.my_info_button.width / 2, 600);
    this.join_match_button.position.set(center_x - this.join_match_button.width / 2, 710);
    this.cancel_match_button.position.set(center_x - this.cancel_match_button.width / 2, 710);

    const rank_gap = 20;
    const rank_row_width = this.rank_daily_button.width + rank_gap + this.rank_weekly_button.width;
    const rank_row_x = center_x - rank_row_width / 2;
    this.rank_daily_button.position.set(rank_row_x, 820);
    this.rank_weekly_button.position.set(rank_row_x + this.rank_daily_button.width + rank_gap, 820);
  }

  public Destroy(): void {
    this.nickname_popup.DestroyPopup();
    this.game_select.DestroySelect();
    this.view.destroy({ children: true });
  }

  private async ConnectToLobby(): Promise<void> {
    if (this.connection.IsConnected()) return;

    this.SetStatus("접속 중...");

    try {
      const result = await this.connection.Connect({
        // 수신 로그는 LobbyConnection 이 항상 남기므로(어떤 메시지든 누락 없이), 여기서는 화면 처리만 한다.
        onEnterLobbyResult: (envelope) => this.HandleEnterLobbyResult(envelope.payload),
        onNameResult: (envelope) => this.HandleNameResult(envelope.payload),
        onPlayInfo: (envelope) => this.ShowInfoPopup("내 정보", FormatPayload(envelope.payload)),
        onRankDaily: (envelope) =>
          this.ShowInfoPopup(`일간 랭킹 (${envelope.payload.date})`, FormatRankList(envelope.payload.list, envelope.payload.my)),
        onRankWeekly: (envelope) =>
          this.ShowInfoPopup(
            `주간 랭킹 (${envelope.payload.term.start} ~ ${envelope.payload.term.end})`,
            FormatRankList(envelope.payload.list, envelope.payload.my)
          ),
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
          // 매칭 성사로 서버가 스스로 끊는 정상 흐름(CONSENTED) — 에러 취급하지 않고 로딩을 보여준다.
          if (code === CloseCode.CONSENTED) {
            console.log(`${LOG_TAG} 로비 연결 종료(게임으로 이동) code=${code}`);
            this.options.loading_overlay.Show("게임 채널 접속 중...");
            return;
          }
          console.log(`${LOG_TAG} 연결 끊어짐 code=${code ?? "-"}`);
          this.nickname_popup.Hide();
          this.SetStatus(`연결이 안됩니다 (code=${code ?? "-"})`);
        },
      });

      console.log(`${LOG_TAG} 접속 정보 ${JSON.stringify(result)}`);

      // 로비 소켓이 연결되면 버튼 없이 바로 ENTER_LOBBY 를 보낸다. 응답을 받기 전까지는 "접속 중"으로 표기한다.
      const payload = BuildEnterLobbyPayload();
      this.connection.SendEnterLobby(payload);
      console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "ENTER_LOBBY", payload })}`);
    } catch (error) {
      console.error(`${LOG_TAG} 접속 실패 ${error instanceof Error ? error.message : String(error)}`);
      this.SetStatus("연결이 안됩니다.");
    }
  }

  // ENTER_LOBBY 응답 처리. 실패(result:N)면 메시지만 보여주고, 성공(result:Y)이면 name 이 공백일 때
  // 별명 입력 팝업을 띄우고, 아니면 바로 메인 UI 로 넘어간다.
  private HandleEnterLobbyResult(payload: EnterLobbyResultPayload): void {
    if (payload.result === "N") {
      const message =
        (payload.error !== undefined && ENTER_LOBBY_ERROR_MESSAGES[payload.error]) || "로비 접속에 실패했습니다.";
      this.SetStatus(message);
      return;
    }

    this.my_userid = payload.userid ?? "";

    if (payload.name !== "") {
      this.ShowMainUi();
      return;
    }

    this.SetStatus("");
    this.nickname_popup.Show({
      onSubmit: (name) => {
        this.connection.SendName({ name });
        console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "NAME", payload: { name } })}`);
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
    this.status.visible = false;
    this.my_info_button.visible = true;
    this.join_match_button.visible = true;
    this.rank_daily_button.visible = true;
    this.rank_weekly_button.visible = true;
    this.game_select.Show();
  }

  private OnClickRankDaily(): void {
    const payload = { game: this.game_select.GetSelectedGame() };
    this.connection.SendRankDaily(payload);
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "RANK_DAILY", payload })}`);
  }

  private OnClickRankWeekly(): void {
    const payload = { game: this.game_select.GetSelectedGame() };
    this.connection.SendRankWeekly(payload);
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "RANK_WEEKLY", payload })}`);
  }

  private OnClickMyInfo(): void {
    const payload = { game: this.game_select.GetSelectedGame() };
    this.connection.SendPlayInfo(payload);
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "PLAY_INFO", payload })}`);
  }

  private OnClickJoinMatch(): void {
    const payload = { game: this.game_select.GetSelectedGame(), select: "Y" as const };
    this.connection.SendJoinMatch(payload);
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "JOIN_MATCH", payload })}`);
    // MATCH_FOUND 는 다른 유저가 매칭될 때까지 즉시 오지 않으므로, 그때까지 취소할 수 있게 한다.
    this.status.visible = true;
    this.SetStatus("상대를 찾는 중...");
    this.ShowCancelMatchButton();
  }

  private OnClickCancelMatch(): void {
    const payload = { game: this.game_select.GetSelectedGame(), select: "N" as const };
    this.connection.SendJoinMatch(payload);
    console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "JOIN_MATCH", payload })}`);
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
    this.options.loading_overlay.Show(`매칭 완료! 상대: ${payload.opponent.name || "(이름 없음)"} — 게임 채널 접속 중...`);

    try {
      const game_room = await this.connection.ConsumeMatchSeat(payload.seat_reservation);
      console.log(`${LOG_TAG} 게임 채널 접속 완료 roomId=${game_room.roomId} sessionId=${game_room.sessionId}`);
      // 게임 종류는 방 이름(othello_1 등)이 가장 정확하다. 못 뽑으면 내가 로비에서 선택해 둔 게임을 쓴다.
      const game = ParseGameIdFromRoomName(payload.room_name) ?? this.game_select.GetSelectedGame();
      this.options.onGameRoomReady({ room: game_room, game, my_userid: this.my_userid, is_rejoin: false });
    } catch (error) {
      console.error(`${LOG_TAG} 게임 채널 접속 실패 ${error instanceof Error ? error.message : String(error)}`);
      this.options.loading_overlay.Hide();
      this.SetStatus("게임 채널 접속 실패 (콘솔 확인) — 다시 시도해 주세요.");
      this.ShowJoinMatchButton();
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
      this.my_info_button.visible = false;
      this.join_match_button.visible = false;
      this.cancel_match_button.visible = false;
      this.rank_daily_button.visible = false;
      this.rank_weekly_button.visible = false;
      this.game_select.Hide();
      this.status.visible = true;
      void this.ConnectToLobby();
    }
  }

  private SetStatus(message: string): void {
    this.status.text = message;
  }
}
