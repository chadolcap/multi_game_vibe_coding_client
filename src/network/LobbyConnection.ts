// 로비 채널 접속 담당. Colyseus Room 을 감싸서 씬(LobbyScene)이 프로토콜 세부사항을
// 몰라도 되게 한다.

import { Client, type Room } from "@colyseus/sdk";
import { NETWORK_CONFIG } from "../config";
import { GetLobbyRoomName } from "../common/channelNames";
import {
  MessageType,
  type Envelope,
  type EnterLobbyPayload,
  type EnterLobbyResultPayload,
  type ErrorPayload,
  type NamePayload,
  type NameResultPayload,
  type PlayInfoPayload,
  type PlayInfoQuery,
  type MatchFoundPayload,
  type JoinMatchPayload,
  type JoinMatchResultPayload,
  type SeatReservation,
  type RejoinGamePayload,
  type NoticePayload,
  type RankQuery,
  type RankDailyPayload,
  type RankWeeklyPayload,
} from "../common/types";

const LOG_TAG = "[Lobby]";

// 서버에서 온 값은 씬이 로그를 잊더라도 여기서 무조건 콘솔에 남긴다.
function LogReceived(type: string | number, message: unknown): void {
  console.log(`${LOG_TAG} 서버에서 받은 내용 type=${String(type)} ${JSON.stringify(message)}`);
}

export interface LobbyEventHandlers {
  // 화면에 그대로 보여줄 수 있도록 payload 만이 아니라 envelope 전체를 넘긴다.
  // 성공/실패 모두 같은 type(ENTER_LOBBY) 으로 온다 — payload.result 로 구분한다.
  onEnterLobbyResult?: (envelope: Envelope<EnterLobbyResultPayload>) => void;
  onNameResult?: (envelope: Envelope<NameResultPayload>) => void;
  onPlayInfo?: (envelope: Envelope<PlayInfoPayload>) => void;
  // JOIN_MATCH 실패도 문서상 같은 type 으로 되돌아온다(성공은 MATCH_FOUND 로 옴 — 확정 아님, 비고 참고).
  onJoinMatchResult?: (envelope: Envelope<JoinMatchResultPayload>) => void;
  onMatchFound?: (envelope: Envelope<MatchFoundPayload>) => void;
  // ENTER_LOBBY 응답 직후, 게임 도중 재접속한 유저에게만 온다.
  onRejoinGame?: (envelope: Envelope<RejoinGamePayload>) => void;
  onRankDaily?: (envelope: Envelope<RankDailyPayload>) => void;
  onRankWeekly?: (envelope: Envelope<RankWeeklyPayload>) => void;
  onError?: (envelope: Envelope<ErrorPayload>) => void;
  // 관리자 공지(SEND_NOTICE, 같은 type 재사용) — 로비에 접속해 있는 동안 언제든 올 수 있다.
  onNotice?: (envelope: Envelope<NoticePayload>) => void;
  // 위 핸들러가 없는 타입(MATCH_FOUND 등 아직 정리 안 된 메시지)은 여기로 들어온다.
  onUnhandledMessage?: (type: string | number, message: unknown) => void;
  onLeave?: (code?: number) => void;
}

// '접속 정보' 화면에 보여줄 값들.
export interface ConnectResult {
  host: string;
  port: number;
  protocol: string;
  channel_no: number;
  room_name: string;
  room_id: string;
  session_id: string;
}

export class LobbyConnection {
  private client: Client | null = null;
  private room: Room | null = null;

  // 로비 채널 2개 중 하나를 랜덤하게 골라 접속한다 (CLAUDE.md 규모 스펙).
  public async Connect(handlers: LobbyEventHandlers): Promise<ConnectResult> {
    const channel_no = Math.floor(Math.random() * NETWORK_CONFIG.lobby_ports.length) + 1;
    const port = NETWORK_CONFIG.lobby_ports[channel_no - 1];
    const protocol = NETWORK_CONFIG.use_tls ? "wss" : "ws";
    const room_name = GetLobbyRoomName(channel_no);

    // MATCH_FOUND 로 받는 seat_reservation 을 나중에 consumeSeatReservation() 에 넘기려면
    // 이 client 인스턴스를 계속 들고 있어야 한다(게임 채널 접속도 이 client 로 연다).
    this.client = new Client(`${protocol}://${NETWORK_CONFIG.host}:${port}`);

    // 로비 룸은 서버 기동 시 미리 만들어져 있으므로 join() 으로 기존 룸에 들어간다
    // (joinOrCreate 를 쓰면 클라이언트가 실수로 새 룸을 만들 수 있어 규약과 맞지 않는다).
    this.room = await this.client.join(room_name);

    this.room.onMessage(MessageType.ENTER_LOBBY, (envelope: Envelope<EnterLobbyResultPayload>) => {
      LogReceived(MessageType.ENTER_LOBBY, envelope);
      handlers.onEnterLobbyResult?.(envelope);
    });
    this.room.onMessage(MessageType.NAME, (envelope: Envelope<NameResultPayload>) => {
      LogReceived(MessageType.NAME, envelope);
      handlers.onNameResult?.(envelope);
    });
    this.room.onMessage(MessageType.PLAY_INFO, (envelope: Envelope<PlayInfoPayload>) => {
      LogReceived(MessageType.PLAY_INFO, envelope);
      handlers.onPlayInfo?.(envelope);
    });
    this.room.onMessage(MessageType.JOIN_MATCH, (envelope: Envelope<JoinMatchResultPayload>) => {
      LogReceived(MessageType.JOIN_MATCH, envelope);
      handlers.onJoinMatchResult?.(envelope);
    });
    this.room.onMessage(MessageType.MATCH_FOUND, (envelope: Envelope<MatchFoundPayload>) => {
      LogReceived(MessageType.MATCH_FOUND, envelope);
      handlers.onMatchFound?.(envelope);
    });
    this.room.onMessage(MessageType.REJOIN_GAME, (envelope: Envelope<RejoinGamePayload>) => {
      LogReceived(MessageType.REJOIN_GAME, envelope);
      handlers.onRejoinGame?.(envelope);
    });
    this.room.onMessage(MessageType.RANK_DAILY, (envelope: Envelope<RankDailyPayload>) => {
      LogReceived(MessageType.RANK_DAILY, envelope);
      handlers.onRankDaily?.(envelope);
    });
    this.room.onMessage(MessageType.RANK_WEEKLY, (envelope: Envelope<RankWeeklyPayload>) => {
      LogReceived(MessageType.RANK_WEEKLY, envelope);
      handlers.onRankWeekly?.(envelope);
    });
    this.room.onMessage(MessageType.ERROR, (envelope: Envelope<ErrorPayload>) => {
      LogReceived(MessageType.ERROR, envelope);
      handlers.onError?.(envelope);
    });
    this.room.onMessage(MessageType.SEND_NOTICE, (envelope: Envelope<NoticePayload>) => {
      LogReceived(MessageType.SEND_NOTICE, envelope);
      handlers.onNotice?.(envelope);
    });
    // 위에서 명시적으로 등록하지 않은 타입은 여기로 온다 (colyseus: 전용 핸들러가 없을 때만 호출됨).
    // 앞으로 서버가 새 메시지 타입을 추가해도 씬 코드를 고치기 전까지는 최소한 여기서 로그는 남는다.
    this.room.onMessage("*", (type: string | number, message: unknown) => {
      LogReceived(type, message);
      handlers.onUnhandledMessage?.(type, message);
    });
    this.room.onLeave((code) => {
      this.room = null;
      handlers.onLeave?.(code);
    });

    return {
      host: NETWORK_CONFIG.host,
      port,
      protocol,
      channel_no,
      room_name,
      room_id: this.room.roomId,
      session_id: this.room.sessionId,
    };
  }

  // 기본 정보 전달 (partner, mid, gender, phone). 서버는 payload 를 그대로 읽으므로
  // envelope 로 감싸지 않고 바로 보낸다.
  public SendEnterLobby(payload: EnterLobbyPayload): void {
    if (!this.room) throw new Error("로비에 접속되어 있지 않습니다.");
    this.room.send(MessageType.ENTER_LOBBY, payload);
  }

  // 별명 등록.
  public SendName(payload: NamePayload): void {
    if (!this.room) throw new Error("로비에 접속되어 있지 않습니다.");
    this.room.send(MessageType.NAME, payload);
  }

  // 게임 참여/매칭 취소. select:"Y" 는 대기열 등록(응답 MATCH_FOUND 는 바로 오지 않고 다른 유저가
  // 매칭될 때까지 기다렸다가 온다), select:"N" 은 대기 취소(예전 CANCEL_MATCH 를 대체함).
  public SendJoinMatch(payload: JoinMatchPayload): void {
    if (!this.room) throw new Error("로비에 접속되어 있지 않습니다.");
    this.room.send(MessageType.JOIN_MATCH, payload);
  }

  // MATCH_FOUND 로 받은 seat_reservation 으로 게임 채널에 새로 접속한다.
  // 이 client 는 로비 접속에 쓴 것과 같지만, consumeSeatReservation() 이 seat_reservation 안의
  // publicAddress(게임 채널 주소)로 새 연결을 열어주므로 포트를 직접 다룰 필요는 없다.
  // 10초(SEAT_RESERVATION_SEC) 안에 호출하지 않으면 예약이 만료되어 실패한다.
  public async ConsumeMatchSeat(seat_reservation: SeatReservation): Promise<Room> {
    if (!this.client) throw new Error("로비에 접속되어 있지 않습니다.");
    return await this.client.consumeSeatReservation(seat_reservation);
  }

  // REJOIN_GAME 으로 받은 reconnection_token 으로 게임 도중 끊겼던 세션에 다시 접속한다.
  // consumeSeatReservation() 과 달리 새 좌석을 받는 게 아니라, client.reconnect() 로 끊기기 전의
  // 그 세션(같은 sessionId)으로 그대로 복귀한다. reconnection_token 은 이미 Colyseus 가 기대하는
  // "roomId:token" 형식으로 합쳐진 문자열이라 그대로 넘긴다(직접 조합하지 않음).
  public async ConsumeRejoinToken(payload: RejoinGamePayload): Promise<Room> {
    if (!this.client) throw new Error("로비에 접속되어 있지 않습니다.");
    return await this.client.reconnect(payload.reconnection_token);
  }

  // 내 정보 조회 요청 — 어떤 게임의 전적을 볼지 game 으로 지정한다.
  public SendPlayInfo(payload: PlayInfoQuery): void {
    if (!this.room) throw new Error("로비에 접속되어 있지 않습니다.");
    this.room.send(MessageType.PLAY_INFO, payload);
  }

  // 일간 랭킹 요청 — 어떤 게임의 랭킹을 볼지 game 으로 지정한다.
  public SendRankDaily(payload: RankQuery): void {
    if (!this.room) throw new Error("로비에 접속되어 있지 않습니다.");
    this.room.send(MessageType.RANK_DAILY, payload);
  }

  // 주간 랭킹 요청 — 어떤 게임의 랭킹을 볼지 game 으로 지정한다.
  public SendRankWeekly(payload: RankQuery): void {
    if (!this.room) throw new Error("로비에 접속되어 있지 않습니다.");
    this.room.send(MessageType.RANK_WEEKLY, payload);
  }

  public IsConnected(): boolean {
    return this.room !== null;
  }
}
