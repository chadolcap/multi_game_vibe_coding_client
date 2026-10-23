// 청기백기 게임 채널(방) 접속 담당. 다른 게임 Connection 과 같은 방식으로 Room 을 감싼다.
// 이 Room 은 LobbyConnection.ConsumeMatchSeat() 이 이미 만들어 준 것을 그대로 받아 쓴다.
// 혼자 하는 게임이라 OUT_USER / OPPONENT_JOINED / GAME_STATUS 는 오지 않는다(서버가 쓰지 않음).

import type { Room } from "@colyseus/sdk";
import {
  MessageType,
  type Envelope,
  type ReadyPayload,
  type GameResultReplayPayload,
  type NoticePayload,
} from "../../common/types";
import {
  FlagMessageType,
  type FlagAnswerPayload,
  type FlagEnterRoomPayload,
  type FlagGameResultPayload,
  type FlagOneResultPayload,
  type FlagOneStartPayload,
  type FlagQuestShowPayload,
} from "./types";

const LOG_TAG = "[Game]";

// 서버에서 온 값은 씬이 로그를 잊더라도 여기서 무조건 콘솔에 남긴다.
function LogReceived(type: string | number, message: unknown): void {
  console.log(`${LOG_TAG} 서버에서 받은 내용 type=${String(type)} ${JSON.stringify(message)}`);
}

function LogSent(type: string, payload?: unknown): void {
  console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify(payload === undefined ? { type } : { type, payload })}`);
}

export interface FlagEventHandlers {
  onEnterRoom?: (envelope: Envelope<FlagEnterRoomPayload>) => void;
  onGameStart?: () => void;
  onOneStart?: (envelope: Envelope<FlagOneStartPayload>) => void;
  onQuestShow?: (envelope: Envelope<FlagQuestShowPayload>) => void;
  onOneResult?: (envelope: Envelope<FlagOneResultPayload>) => void;
  onGameResult?: (envelope: Envelope<FlagGameResultPayload>) => void;
  // GAME_RESULT 에서 나가기를 선택한(또는 선택 시간을 넘긴) 유저에게 온다 (payload 없음).
  onReturnToLobby?: () => void;
  // 관리자 공지(SEND_NOTICE, 같은 type 재사용) — 게임 중에도 언제든 올 수 있다.
  onNotice?: (envelope: Envelope<NoticePayload>) => void;
  // 위 핸들러가 없는 타입은 여기로 들어온다 (colyseus: 전용 핸들러가 없을 때만 호출됨).
  onUnhandledMessage?: (type: string | number, message: unknown) => void;
  onLeave?: (code?: number) => void;
}

export class FlagConnection {
  private readonly room: Room;
  // 씬 콜백. Dispose() 후에는 null 이 되어, 늦게 도착한 메시지는 로그만 남고 파괴된 씬을 건드리지 않는다.
  private handlers: FlagEventHandlers | null = null;
  private disposed = false;

  constructor(room: Room) {
    this.room = room;
  }

  public Listen(handlers: FlagEventHandlers): void {
    if (this.disposed) return;
    this.handlers = handlers;
    this.room.onMessage(MessageType.ENTER_ROOM, (envelope: Envelope<FlagEnterRoomPayload>) => {
      LogReceived(MessageType.ENTER_ROOM, envelope);
      this.handlers?.onEnterRoom?.(envelope);
    });
    this.room.onMessage(MessageType.GAME_START, (envelope: Envelope<unknown>) => {
      LogReceived(MessageType.GAME_START, envelope);
      this.handlers?.onGameStart?.();
    });
    this.room.onMessage(FlagMessageType.ONE_START, (envelope: Envelope<FlagOneStartPayload>) => {
      LogReceived(FlagMessageType.ONE_START, envelope);
      this.handlers?.onOneStart?.(envelope);
    });
    this.room.onMessage(FlagMessageType.QUEST_SHOW, (envelope: Envelope<FlagQuestShowPayload>) => {
      LogReceived(FlagMessageType.QUEST_SHOW, envelope);
      this.handlers?.onQuestShow?.(envelope);
    });
    this.room.onMessage(FlagMessageType.ONE_RESULT, (envelope: Envelope<FlagOneResultPayload>) => {
      LogReceived(FlagMessageType.ONE_RESULT, envelope);
      this.handlers?.onOneResult?.(envelope);
    });
    this.room.onMessage(MessageType.GAME_RESULT, (envelope: Envelope<FlagGameResultPayload>) => {
      LogReceived(MessageType.GAME_RESULT, envelope);
      this.handlers?.onGameResult?.(envelope);
    });
    this.room.onMessage(MessageType.RETURN_TO_LOBBY, (envelope: Envelope<unknown>) => {
      LogReceived(MessageType.RETURN_TO_LOBBY, envelope);
      this.handlers?.onReturnToLobby?.();
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

  // 씬이 파괴될 때 호출한다 — 콜백만 끊고 연결은 그대로 둔다(나가기는 SendReplay / Leave 로 따로 처리).
  public Dispose(): void {
    this.disposed = true;
    this.handlers = null;
  }

  // 게임방 입장 정보 요청 (payload 없음).
  public SendEnterRoom(): void {
    this.room.send(MessageType.ENTER_ROOM);
    LogSent(MessageType.ENTER_ROOM);
  }

  // 게임 준비. 혼자라 ready:"Y" 만 의미가 있다(서버는 ready:"N" 을 무시).
  public SendReady(payload: ReadyPayload): void {
    this.room.send(MessageType.READY, payload);
    LogSent(MessageType.READY, payload);
  }

  // 답 — 문제에 나온 깃발을 다 누르면 한 번만 보낸다(서버는 처음 온 답으로 판정한다).
  public SendAnswer(payload: FlagAnswerPayload): void {
    this.room.send(FlagMessageType.QUEST_SHOW, payload);
    LogSent(FlagMessageType.QUEST_SHOW, payload);
  }

  // 최종 결과 후 재시작/나가기 선택 (같은 type 을 재사용한다).
  public SendReplay(payload: GameResultReplayPayload): void {
    this.room.send(MessageType.GAME_RESULT, payload);
    LogSent(MessageType.GAME_RESULT, payload);
  }

  // 게임 중 나가기 — 방 연결을 직접 끊는다. 서버는 그때까지 맞춘 점수로 저장하고 방을 없앤다(재접속 없음).
  public Leave(): void {
    console.log(`${LOG_TAG} 게임 채널 나가기 요청`);
    void this.room.leave(true);
  }
}
