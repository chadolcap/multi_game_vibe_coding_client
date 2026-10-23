// 에어하키 게임 채널(방) 접속 담당. SteppingConnection 과 같은 방식으로 Room 을 감싼다.
// 이 Room 은 LobbyConnection.ConsumeMatchSeat() 이 이미 만들어 준 것을 그대로 받아 쓴다.

import type { Room } from "@colyseus/sdk";
import {
  MessageType,
  type Envelope,
  type EnterRoomPayload,
  type OutUserPayload,
  type ReadyPayload,
  type GameResultReplayPayload,
  type OpponentJoinedPayload,
  type NoticePayload,
} from "../../common/types";
import {
  AirhockeyMessageType,
  type AirhockeyLeverMovePayload,
  type AirhockeyPuckMovePayload,
  type AirhockeyLeverMoveResultPayload,
  type AirhockeyOneResultPayload,
  type AirhockeyGameStatusPayload,
  type AirhockeyGameResultPayload,
} from "./types";

const LOG_TAG = "[Game]";

// 서버에서 온 값은 씬이 로그를 잊더라도 여기서 무조건 콘솔에 남긴다.
function LogReceived(type: string | number, message: unknown): void {
  console.log(`${LOG_TAG} 서버에서 받은 내용 type=${String(type)} ${JSON.stringify(message)}`);
}

function LogSent(type: string, payload?: unknown): void {
  console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify(payload === undefined ? { type } : { type, payload })}`);
}

export interface AirhockeyEventHandlers {
  onEnterRoom?: (envelope: Envelope<EnterRoomPayload>) => void;
  onOutUser?: (envelope: Envelope<OutUserPayload>) => void;
  onGameStart?: () => void;
  onOneStart?: () => void;
  onPuckMove?: (envelope: Envelope<AirhockeyPuckMovePayload>) => void;
  onLeverMove?: (envelope: Envelope<AirhockeyLeverMoveResultPayload>) => void;
  onOneResult?: (envelope: Envelope<AirhockeyOneResultPayload>) => void;
  onGameStatus?: (envelope: Envelope<AirhockeyGameStatusPayload>) => void;
  onGameResult?: (envelope: Envelope<AirhockeyGameResultPayload>) => void;
  // GAME_RESULT 에서 나가기를 선택한(또는 선택 시간을 넘긴) 유저에게만 온다 (payload 없음).
  onReturnToLobby?: () => void;
  // 재게임 신청 후 새 상대를 기다리던 중, 새 상대가 입장했을 때 온다.
  onOpponentJoined?: (envelope: Envelope<OpponentJoinedPayload>) => void;
  // 관리자 공지(SEND_NOTICE, 같은 type 재사용) — 게임 중에도 언제든 올 수 있다.
  onNotice?: (envelope: Envelope<NoticePayload>) => void;
  // 위 핸들러가 없는 타입은 여기로 들어온다 (colyseus: 전용 핸들러가 없을 때만 호출됨).
  onUnhandledMessage?: (type: string | number, message: unknown) => void;
  onLeave?: (code?: number) => void;
}

export class AirhockeyConnection {
  private readonly room: Room;
  // 씬 콜백. Dispose() 후에는 null 이 되어, 늦게 도착한 메시지는 로그만 남고 파괴된 씬을 건드리지 않는다.
  private handlers: AirhockeyEventHandlers | null = null;
  private disposed = false;
  // 판마다 첫 PUCK_MOVE 만 로그를 남겼는지(Listen 의 PUCK_MOVE 주석 참고).
  private puck_logged = false;
  // 판마다 첫 LEVER_MOVE(C->S)만 로그를 남겼는지 — 보내는 쪽도 초당 수십 번이라 같은 규칙을 쓴다.
  private lever_logged = false;

  constructor(room: Room) {
    this.room = room;
  }

  public Listen(handlers: AirhockeyEventHandlers): void {
    if (this.disposed) return;
    this.handlers = handlers;
    this.room.onMessage(MessageType.ENTER_ROOM, (envelope: Envelope<EnterRoomPayload>) => {
      LogReceived(MessageType.ENTER_ROOM, envelope);
      this.handlers?.onEnterRoom?.(envelope);
    });
    this.room.onMessage(MessageType.OUT_USER, (envelope: Envelope<OutUserPayload>) => {
      LogReceived(MessageType.OUT_USER, envelope);
      this.handlers?.onOutUser?.(envelope);
    });
    this.room.onMessage(MessageType.GAME_START, (envelope: Envelope<unknown>) => {
      LogReceived(MessageType.GAME_START, envelope);
      this.handlers?.onGameStart?.();
    });
    this.room.onMessage(AirhockeyMessageType.ONE_START, (envelope: Envelope<unknown>) => {
      LogReceived(AirhockeyMessageType.ONE_START, envelope);
      this.handlers?.onOneStart?.();
    });
    // ⚠️ PUCK_MOVE / LEVER_MOVE 는 초당 30번씩 오므로 매번 콘솔에 남기지 않는다 — 다 남기면 콘솔이 다른 메시지를
    //    찾을 수 없을 만큼 넘치고 브라우저도 느려진다(서버도 같은 이유로 LEVER_MOVE 를 로그하지 않는다).
    //    대신 판마다 첫 PUCK_MOVE 만 남겨 좌표가 오는지는 확인할 수 있게 한다.
    this.room.onMessage(AirhockeyMessageType.PUCK_MOVE, (envelope: Envelope<AirhockeyPuckMovePayload>) => {
      if (!this.puck_logged) {
        this.puck_logged = true;
        LogReceived(AirhockeyMessageType.PUCK_MOVE, envelope);
      }
      this.handlers?.onPuckMove?.(envelope);
    });
    this.room.onMessage(AirhockeyMessageType.LEVER_MOVE, (envelope: Envelope<AirhockeyLeverMoveResultPayload>) => {
      this.handlers?.onLeverMove?.(envelope);
    });
    this.room.onMessage(AirhockeyMessageType.ONE_RESULT, (envelope: Envelope<AirhockeyOneResultPayload>) => {
      LogReceived(AirhockeyMessageType.ONE_RESULT, envelope);
      this.puck_logged = false;
      this.lever_logged = false;
      this.handlers?.onOneResult?.(envelope);
    });
    this.room.onMessage(AirhockeyMessageType.GAME_STATUS, (envelope: Envelope<AirhockeyGameStatusPayload>) => {
      LogReceived(AirhockeyMessageType.GAME_STATUS, envelope);
      this.handlers?.onGameStatus?.(envelope);
    });
    this.room.onMessage(MessageType.GAME_RESULT, (envelope: Envelope<AirhockeyGameResultPayload>) => {
      LogReceived(MessageType.GAME_RESULT, envelope);
      this.handlers?.onGameResult?.(envelope);
    });
    this.room.onMessage(MessageType.RETURN_TO_LOBBY, (envelope: Envelope<unknown>) => {
      LogReceived(MessageType.RETURN_TO_LOBBY, envelope);
      this.handlers?.onReturnToLobby?.();
    });
    this.room.onMessage(MessageType.OPPONENT_JOINED, (envelope: Envelope<OpponentJoinedPayload>) => {
      LogReceived(MessageType.OPPONENT_JOINED, envelope);
      this.handlers?.onOpponentJoined?.(envelope);
    });
    this.room.onMessage(MessageType.SEND_NOTICE, (envelope: Envelope<NoticePayload>) => {
      LogReceived(MessageType.SEND_NOTICE, envelope);
      this.handlers?.onNotice?.(envelope);
    });
    // 위에서 명시적으로 등록하지 않은 타입은 여기로 온다 (colyseus: 전용 핸들러가 없을 때만 호출됨).
    this.room.onMessage("*", (type: string | number, message: unknown) => {
      LogReceived(type, message);
      this.handlers?.onUnhandledMessage?.(type, message);
    });
    this.room.onLeave((code) => {
      console.log(`${LOG_TAG} 게임 채널 연결 끊어짐 code=${code ?? "-"}`);
      this.handlers?.onLeave?.(code);
    });
  }

  // 씬이 파괴될 때 호출한다 — 콜백만 끊고 연결은 그대로 둔다(나가기는 서버에 보내는 메시지로 따로 처리).
  public Dispose(): void {
    this.disposed = true;
    this.handlers = null;
  }

  // 게임방 입장 정보 요청 (payload 없음).
  public SendEnterRoom(): void {
    this.room.send(MessageType.ENTER_ROOM);
    LogSent(MessageType.ENTER_ROOM);
  }

  // 게임 준비/취소. ready:"N" 을 보내면 준비를 취소한다.
  public SendReady(payload: ReadyPayload): void {
    this.room.send(MessageType.READY, payload);
    LogSent(MessageType.READY, payload);
  }

  // 내 레버 위치(내 기준 좌표). 초당 수십 번 보내므로 판마다 첫 번째(ONE_START 직후 시작 자리)만 콘솔에 남긴다.
  public SendLeverMove(payload: AirhockeyLeverMovePayload): void {
    this.room.send(AirhockeyMessageType.LEVER_MOVE, payload);
    if (!this.lever_logged) {
      this.lever_logged = true;
      LogSent(AirhockeyMessageType.LEVER_MOVE, payload);
    }
  }

  // 최종 결과 후 재시작/나가기 선택 (같은 type 을 재사용한다).
  public SendReplay(payload: GameResultReplayPayload): void {
    this.room.send(MessageType.GAME_RESULT, payload);
    LogSent(MessageType.GAME_RESULT, payload);
  }
}
