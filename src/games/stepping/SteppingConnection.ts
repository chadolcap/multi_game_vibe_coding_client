// 점핑 게임 채널(방) 접속 담당. OthelloConnection 과 같은 방식으로 Room 을 감싼다.
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
  SteppingMessageType,
  type SteppingMapSelectPayload,
  type SteppingRemainTimePayload,
  type SteppingMoveInfoPayload,
  type SteppingMoveInfoResultPayload,
  type SteppingGameStatusPayload,
  type SteppingGameResultPayload,
} from "./types";

const LOG_TAG = "[Game]";

// 서버에서 온 값은 씬이 로그를 잊더라도 여기서 무조건 콘솔에 남긴다.
function LogReceived(type: string | number, message: unknown): void {
  console.log(`${LOG_TAG} 서버에서 받은 내용 type=${String(type)} ${JSON.stringify(message)}`);
}

export interface SteppingEventHandlers {
  onEnterRoom?: (envelope: Envelope<EnterRoomPayload>) => void;
  onOutUser?: (envelope: Envelope<OutUserPayload>) => void;
  onMapSelect?: (envelope: Envelope<SteppingMapSelectPayload>) => void;
  onGameStart?: () => void;
  onGameRemainTime?: (envelope: Envelope<SteppingRemainTimePayload>) => void;
  onMoveInfo?: (envelope: Envelope<SteppingMoveInfoResultPayload>) => void;
  onGameStatus?: (envelope: Envelope<SteppingGameStatusPayload>) => void;
  onGameResult?: (envelope: Envelope<SteppingGameResultPayload>) => void;
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

export class SteppingConnection {
  private readonly room: Room;
  // 씬 콜백. Dispose() 후에는 null 이 되어, 늦게 도착한 메시지는 로그만 남고 파괴된 씬을 건드리지 않는다.
  private handlers: SteppingEventHandlers | null = null;
  private disposed = false;

  constructor(room: Room) {
    this.room = room;
  }

  public Listen(handlers: SteppingEventHandlers): void {
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
    this.room.onMessage(SteppingMessageType.MAP_SELECT, (envelope: Envelope<SteppingMapSelectPayload>) => {
      LogReceived(SteppingMessageType.MAP_SELECT, envelope);
      this.handlers?.onMapSelect?.(envelope);
    });
    this.room.onMessage(MessageType.GAME_START, (envelope: Envelope<unknown>) => {
      LogReceived(MessageType.GAME_START, envelope);
      this.handlers?.onGameStart?.();
    });
    this.room.onMessage(SteppingMessageType.GAME_REMAIN_TIME, (envelope: Envelope<SteppingRemainTimePayload>) => {
      LogReceived(SteppingMessageType.GAME_REMAIN_TIME, envelope);
      this.handlers?.onGameRemainTime?.(envelope);
    });
    this.room.onMessage(SteppingMessageType.MOVE_INFO, (envelope: Envelope<SteppingMoveInfoResultPayload>) => {
      LogReceived(SteppingMessageType.MOVE_INFO, envelope);
      this.handlers?.onMoveInfo?.(envelope);
    });
    this.room.onMessage(SteppingMessageType.GAME_STATUS, (envelope: Envelope<SteppingGameStatusPayload>) => {
      LogReceived(SteppingMessageType.GAME_STATUS, envelope);
      this.handlers?.onGameStatus?.(envelope);
    });
    this.room.onMessage(MessageType.GAME_RESULT, (envelope: Envelope<SteppingGameResultPayload>) => {
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
  }

  // 게임 준비/취소. ready:"N" 을 보내면 준비를 취소한다.
  public SendReady(payload: ReadyPayload): void {
    this.room.send(MessageType.READY, payload);
  }

  // 점프 한 번의 결과(도착 칸 번호/칸 중심 기준 좌표/착지 여부).
  public SendMoveInfo(payload: SteppingMoveInfoPayload): void {
    this.room.send(SteppingMessageType.MOVE_INFO, payload);
  }

  // 최종 결과 후 재시작/나가기 선택 (같은 type 을 재사용한다).
  public SendReplay(payload: GameResultReplayPayload): void {
    this.room.send(MessageType.GAME_RESULT, payload);
  }
}
