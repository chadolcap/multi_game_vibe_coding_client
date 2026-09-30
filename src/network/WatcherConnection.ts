// 관리자(Watcher) 채널 접속 담당. Colyseus Room 을 감싸서 관리자 페이지가 프로토콜 세부사항을
// 몰라도 되게 한다 (LobbyConnection/GameConnection 과 같은 패턴).

import { Client, type Room } from "@colyseus/sdk";
import { NETWORK_CONFIG } from "../config";
import {
  MessageType,
  type Envelope,
  type AdminLoginPayload,
  type AdminLoginResultPayload,
  type AdminChannelCountPayload,
  type AdminChannelUserQuery,
  type AdminChannelUserResultPayload,
  type SendNoticePayload,
  type ErrorPayload,
} from "../common/types";

const LOG_TAG = "[Admin]";
// 서버: GetWatcherRoomName() — 채널이 1개뿐이라 로비/게임과 달리 번호를 붙이지 않는다.
const WATCHER_ROOM_NAME = "watcher";

// 서버에서 온 값은 화면이 로그를 잊더라도 여기서 무조건 콘솔에 남긴다.
function LogReceived(type: string | number, message: unknown): void {
  console.log(`${LOG_TAG} 서버에서 받은 내용 type=${String(type)} ${JSON.stringify(message)}`);
}

export interface WatcherEventHandlers {
  onLoginResult?: (envelope: Envelope<AdminLoginResultPayload>) => void;
  onChannelCount?: (envelope: Envelope<AdminChannelCountPayload>) => void;
  onChannelUser?: (envelope: Envelope<AdminChannelUserResultPayload>) => void;
  onError?: (envelope: Envelope<ErrorPayload>) => void;
  // 위 핸들러가 없는 타입은 여기로 들어온다 (colyseus: 전용 핸들러가 없을 때만 호출됨).
  onUnhandledMessage?: (type: string | number, message: unknown) => void;
  onLeave?: (code?: number) => void;
}

export class WatcherConnection {
  private room: Room | null = null;

  // watcher 룸은 서버 기동 시 미리 만들어져 있으므로 join() 으로 기존 룸에 들어간다.
  public async Connect(handlers: WatcherEventHandlers): Promise<void> {
    const protocol = NETWORK_CONFIG.use_tls ? "wss" : "ws";
    const client = new Client(`${protocol}://${NETWORK_CONFIG.host}:${NETWORK_CONFIG.watcher_port}`);
    this.room = await client.join(WATCHER_ROOM_NAME);

    this.room.onMessage(MessageType.ADMIN_LOGIN, (envelope: Envelope<AdminLoginResultPayload>) => {
      LogReceived(MessageType.ADMIN_LOGIN, envelope);
      handlers.onLoginResult?.(envelope);
    });
    this.room.onMessage(MessageType.ADMIN_CHANNEL_COUNT, (envelope: Envelope<AdminChannelCountPayload>) => {
      LogReceived(MessageType.ADMIN_CHANNEL_COUNT, envelope);
      handlers.onChannelCount?.(envelope);
    });
    this.room.onMessage(MessageType.ADMIN_CHANNEL_USER, (envelope: Envelope<AdminChannelUserResultPayload>) => {
      LogReceived(MessageType.ADMIN_CHANNEL_USER, envelope);
      handlers.onChannelUser?.(envelope);
    });
    this.room.onMessage(MessageType.ERROR, (envelope: Envelope<ErrorPayload>) => {
      LogReceived(MessageType.ERROR, envelope);
      handlers.onError?.(envelope);
    });
    this.room.onMessage("*", (type: string | number, message: unknown) => {
      LogReceived(type, message);
      handlers.onUnhandledMessage?.(type, message);
    });
    this.room.onLeave((code) => {
      this.room = null;
      handlers.onLeave?.(code);
    });
  }

  // 로그인. 실패하면 서버가 바로 연결을 끊는다(ADMIN_LOGIN 응답의 result:"N" + onLeave 로 알 수 있음).
  public SendAdminLogin(payload: AdminLoginPayload): void {
    if (!this.room) throw new Error("관리자 채널에 접속되어 있지 않습니다.");
    this.room.send(MessageType.ADMIN_LOGIN, payload);
  }

  // 전체 채널(로비+게임)의 현재 접속자 수 요청 (payload 없음).
  public SendChannelCountRequest(): void {
    if (!this.room) throw new Error("관리자 채널에 접속되어 있지 않습니다.");
    this.room.send(MessageType.ADMIN_CHANNEL_COUNT);
  }

  // 특정 채널(lobby:N 또는 game:N)의 접속자 목록 요청.
  public SendChannelUserRequest(payload: AdminChannelUserQuery): void {
    if (!this.room) throw new Error("관리자 채널에 접속되어 있지 않습니다.");
    this.room.send(MessageType.ADMIN_CHANNEL_USER, payload);
  }

  // 채널(로비/게임) 유저에게 공지 전송 — 응답 없음(발사 후 잊기).
  public SendNotice(payload: SendNoticePayload): void {
    if (!this.room) throw new Error("관리자 채널에 접속되어 있지 않습니다.");
    this.room.send(MessageType.SEND_NOTICE, payload);
  }

  public IsConnected(): boolean {
    return this.room !== null;
  }
}
