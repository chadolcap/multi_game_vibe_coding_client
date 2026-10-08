// 통신 프로토콜 타입.
// 기준 문서(계속 갱신됨, 로컬 엑셀로 관리):
// d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx ("통신규약" 시트)
// 실제 서버 응답으로 확인된 필드 형태를 우선한다 — 문서와 다르면 문서에 파란 글씨로 비고를 남겨둔다.

// S->C 메시지는 항상 이 envelope 형태로 온다. { type, payload, ts }
export interface Envelope<P = unknown> {
  type: string;
  payload: P;
  ts: number;
}

export const MessageType = {
  // C->S / S->C 같은 type 재사용. 2026-09-30 서버 변경: 기존에 LOBBY_ENTERED 로 따로 오던 값을
  // 이제 이 응답에 합쳐서 보낸다 — LOBBY_ENTERED 는 더 이상 쓰지 않는다.
  ENTER_LOBBY: "ENTER_LOBBY",
  NAME: "NAME", // C->S (별명 등록) / 같은 type 으로 S->C 응답
  PLAY_INFO: "PLAY_INFO", // C->S 요청(payload 없음) / S->C 응답
  JOIN_MATCH: "JOIN_MATCH", // C->S { select: "Y"|"N" } — Y: 게임 참여, N: 매칭 대기 취소 (CANCEL_MATCH 는 더 이상 안 씀)
  MATCH_FOUND: "MATCH_FOUND", // S->C — 매칭 성사(엑셀 문서의 JOIN_MATCH 성공 응답과 별도 메시지, 아래 주석 참고)
  ENTER_ROOM: "ENTER_ROOM", // C->S 요청(게임방 입장, payload 없음) / S->C 응답
  OUT_USER: "OUT_USER", // S->C (게임 전/후 상대 퇴장 알림)
  READY: "READY", // C->S (게임 준비/취소) / 같은 type 으로 S->C 응답
  GAME_START: "GAME_START", // S->C (payload 없음)
  // 가위바위보 전용 판 진행 메시지(ONE_START/ONE_REMAIN_TIME/SELECT_GAME/ONE_RESULT)는 games/rps/types.ts 의 RpsMessageType 참고.
  GAME_RESULT: "GAME_RESULT", // S->C (최종 결과) / 같은 type 으로 C->S 재시작 요청
  RETURN_TO_LOBBY: "RETURN_TO_LOBBY", // S->C (payload 없음) — 로비로 돌아가야 하는 유저에게만 온다
  OPPONENT_JOINED: "OPPONENT_JOINED", // S->C — 재게임 신청 후 새 상대를 기다리던 중, 새 상대가 입장했을 때
  REJOIN_GAME: "REJOIN_GAME", // S->C — ENTER_LOBBY 응답 직후, 게임 도중 끊겼다가 재접속한 유저에게만 온다.
  RANK_DAILY: "RANK_DAILY", // C->S 요청({game}) / S->C 같은 type 재사용 — 일간 랭킹 상위 10명 + 내 정보
  RANK_WEEKLY: "RANK_WEEKLY", // C->S 요청({game}) / S->C 같은 type 재사용 — 주간 랭킹 상위 10명 + 내 정보
  ERROR: "ERROR", // S->C

  // 관리자(Watcher) 채널 전용 — 로컬 엑셀 "관리자" 시트 + 서버 소스(server/src/common/types.ts) 기준.
  // ADMIN_LOGIN 은 시트에는 없지만, 로그인 없이는 다른 관리자 메시지를 서버가 전부 무시하므로 필수다.
  ADMIN_LOGIN: "ADMIN_LOGIN", // C->S {id, password} / S->C 같은 type 재사용 {result:"Y"|"N"} — 실패 시 서버가 연결을 끊는다
  ADMIN_CHANNEL_COUNT: "ADMIN_CHANNEL_COUNT", // C->S 요청(payload 없음) / S->C {count: {room_name: 접속자수}}
  ADMIN_CHANNEL_USER: "ADMIN_CHANNEL_USER", // C->S {game, channel} / S->C 같은 type 재사용
  // C->S(admin.html) {time:{mon,day,start,end}, channel:[...], message} — 응답 없음(발사 후 잊기).
  // ⚠️ 실제 서버는 아직 time 필드를 받지 않는다(엑셀 예시에는 있지만 서버 소스 주석에 "이번 구현 범위에서는
  // 안 받음, 필요하면 별도 논의"라고 되어 있음) — 보내도 무시될 뿐이라 UI 는 남겨두되 동작은 기대하지 말 것.
  // S->C(로비/게임) 는 같은 type 을 재사용해 관리자 공지를 뿌린다(payload: NoticePayload, 예전 이름 NOTICE 는 폐지됨).
  SEND_NOTICE: "SEND_NOTICE",
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const ErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_ID: "INVALID_ID",
  ALREADY_CONNECTED: "ALREADY_CONNECTED",
  ALREADY_ENTERED: "ALREADY_ENTERED",
  ENTER_TIMEOUT: "ENTER_TIMEOUT",
  SERVER_ERROR: "SERVER_ERROR",
  CHANNEL_FULL: "CHANNEL_FULL",
  NO_GAME_ROOM: "NO_GAME_ROOM",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

// ENTER_LOBBY 로 보내는 값 (C->S). 문서 예시 값을 그대로 테스트에 쓴다.
export interface EnterLobbyPayload {
  partner: string;
  mid: string;
  gender: "F" | "M";
  phone: string;
}

// ENTER_LOBBY 응답 (S->C, 같은 type 재사용).
// 실패: result:"N", error: 1=형식 오류, 2=중복 접속, 3=DB/Redis 오류, 4=기타 (엑셀 문서 + 서버 확인란 기준)
// 성공: result:"Y" 와 함께 userid/new/name/avatar 가 같이 온다.
// new: 신규 유저 여부(Y/N), name: 별명(신규 유저는 공백)
export interface EnterLobbyResultPayload {
  result: "Y" | "N";
  userid?: string; // result:Y 일 때만
  new?: "Y" | "N"; // result:Y 일 때만
  name?: string; // result:Y 일 때만
  avatar?: string; // result:Y 일 때만
  error?: number; // result:N 일 때만
}

// NAME 으로 보내는 값 (C->S, 별명 등록)
export interface NamePayload {
  name: string;
}

// NAME 응답 (S->C). 실패 시 error: 1=이미 사용 중인 별명, 2=욕설 등 부적절한 별명,
// 3=서버 오류(DB/Redis) — 문서에는 없지만 서버가 추가로 보낸다고 확인해줌(문서 I10 비고 참고).
export interface NameResultPayload {
  result: "Y" | "N";
  error?: number;
}

// PLAY_INFO 로 보내는 값 (C->S). 2026-10-06 서버 변경: 어떤 게임의 정보를 조회할지 game 필드가 추가됐다.
export interface PlayInfoQuery {
  game: GameId;
}

// PLAY_INFO 응답 (S->C, 같은 type 재사용) — 요청한 game 기준의 전적.
export interface PlayInfoPayload {
  result: "Y" | "N";
  total_game_count: number;
  total_win_count: number;
  today_game_count: number;
  today_win_count: number;
}

// 로비에서 고를 수 있는 게임. 서버 문서(I11) 기준 식별자 — 가위바위보=rps, 오델로=othello.
// 오델로는 아직 게임 로직(games/othello 등)이 없어 선택 UI 에서는 비활성화해 둔다.
export const GameId = {
  RPS: "rps",
  OTHELLO: "othello",
} as const;
export type GameId = (typeof GameId)[keyof typeof GameId];

// JOIN_MATCH 로 보내는 값 (C->S). 2026-10-02 서버 변경: 로비에서 게임을 선택해 입장하는 방식을
// 준비하며 game 필드가 추가됐다. select:"Y" 는 게임 참여(매칭 대기열 등록), select:"N" 은
// 매칭 대기 취소 — 예전에 따로 있던 CANCEL_MATCH 를 대체한다.
export interface JoinMatchPayload {
  game: GameId;
  select: "Y" | "N";
}

// JOIN_MATCH 실패 응답 (S->C, 같은 type 재사용). error: 1=빈 방 없음, 2=기타.
// 성공(select:Y 를 받아준 경우)에는 문서에 ip/port 로 적혀 있지만, 서버 확인란(I13)에 따르면 실제로는
// 이 type 이 아니라 별도의 MATCH_FOUND 로 seat_reservation 을 보낸다 — 확정된 사양은 아니라고 하니 계속 확인이 필요하다.
export interface JoinMatchResultPayload {
  result: "Y" | "N";
  error?: number;
}

// MATCH_FOUND 의 seat_reservation — client.consumeSeatReservation() 에 그대로 넘긴다.
// (colyseus matchMaker.reserveSeatFor() 가 만드는 ISeatReservation 의 서브셋)
// 엑셀 문서에는 JOIN_MATCH 성공 응답에 ip/port 가 오는 것으로 적혀 있지만, 실제 서버는
// Colyseus 매치메이킹을 그대로 써서 별도의 MATCH_FOUND 메시지로 seat_reservation 을 보낸다.
export interface SeatReservation {
  name: string;
  sessionId: string;
  roomId: string;
  processId?: string;
  reconnectionToken?: string;
  publicAddress?: string;
}

export interface OpponentInfo {
  name: string;
  avatar: string;
}

// MATCH_FOUND 로 받는 값 (S->C). 도착하면 로비 연결은 서버가 CONSENTED(4000) 로 스스로 끊는다.
export interface MatchFoundPayload {
  room_name: string;
  room_id: string;
  seat_reservation: SeatReservation;
  opponent: OpponentInfo;
}

// ENTER_ROOM/OPPONENT_JOINED 응답에서 한 명의 정보. name(별명)은 문서에는 없었지만
// 요청에 따라 서버가 추가해줬다 (RoomPlayerInfo, 2026-09-28).
export interface RoomPlayerInfo {
  userid: string;
  name: string;
  avatar: string;
  win_per: number;
}

// ENTER_ROOM 으로 받는 값 (S->C). 요청은 payload 없음.
// player1/player2 중 어느 쪽이 나인지는 문서에 표시가 없어, userid 를 내 userid(LOBBY_ENTERED 로 이미 알고 있음)와
// 비교해서 클라이언트가 직접 구분해야 한다.
export interface EnterRoomPayload {
  result: "Y" | "N";
  room: string;
  player1: RoomPlayerInfo;
  player2: RoomPlayerInfo;
}

// OUT_USER 로 받는 값 (S->C). 게임 전/후 상대가 나갔을 때 온다.
export interface OutUserPayload {
  userid: string;
}

// OPPONENT_JOINED 로 받는 값 (S->C). 재게임을 신청했는데 상대가 나가서 "기다리는 방"으로 등록된 뒤,
// 새 상대가 이 방에 들어오면 온다.
export interface OpponentJoinedPayload {
  player: RoomPlayerInfo;
}

// REJOIN_GAME 으로 받는 값 (S->C). 실제 서버 응답으로 확인됨(2026-09-30) — reconnection_token 은
// 이미 Colyseus 가 기대하는 "roomId:token" 형식으로 합쳐진 문자열이라, client.reconnect() 에 그대로 넘기면
// 새 좌석이 아니라 끊기기 전의 그 세션으로 복귀한다. room_id/room_name 은 로그용으로만 쓴다.
export interface RejoinGamePayload {
  room_name: string;
  room_id: string;
  reconnection_token: string;
}

// RANK_DAILY/RANK_WEEKLY 의 랭킹 한 줄 — [별명, 점수] 튜플(문서 표기 그대로).
export type RankEntry = [name: string, score: number];

// RANK_DAILY/RANK_WEEKLY 응답의 내 순위 정보.
export interface MyRankInfo {
  rank: number;
  score: number;
}

// RANK_DAILY/RANK_WEEKLY 로 보내는 값 (C->S). 2026-10-06 서버 변경: 어떤 게임의 랭킹을 조회할지 game 필드가 추가됐다.
export interface RankQuery {
  game: GameId;
}

// RANK_DAILY 응답 (S->C, 같은 type 재사용). 요청한 game 기준 일간 랭킹 상위 10명 + 내 정보.
export interface RankDailyPayload {
  date: string;
  list: RankEntry[];
  my: MyRankInfo;
}

// RANK_WEEKLY 응답 (S->C, 같은 type 재사용). 요청한 game 기준 주간 랭킹 상위 10명 + 내 정보.
export interface RankWeeklyPayload {
  term: { start: string; end: string };
  list: RankEntry[];
  my: MyRankInfo;
}

// READY 로 보내는 값 (C->S). 취소할 때는 ready:"N".
export interface ReadyPayload {
  ready: "Y" | "N";
}

// GAME_RESULT 의 winner/loser — 2026-10-01 서버 변경. player1/player2{개수}+win(승자 userid) 대신
// 승자/패자를 바로 구분해서 보낸다(플레이어 쪽을 직접 가리키므로 더 이상 player1/player2+win 비교가 필요 없음).
export interface GameResultPlayerInfo {
  userid: string;
  win_count: number;
  win_per: number; // total_win_count 기준의 승율
}

// GAME_RESULT 로 받는 값 (S->C, 최종 결과)
export interface GameResultPayload {
  winner: GameResultPlayerInfo;
  loser: GameResultPlayerInfo;
}

// GAME_RESULT 로 보내는 값 (C->S, 재시작 선택 — 같은 type 을 재사용한다)
export interface GameResultReplayPayload {
  replay: "Y" | "N";
}

// ───────────────────────── 관리자(Watcher) ─────────────────────────
// 로컬 엑셀 "관리자" 시트 + 서버 소스(server/src/common/types.ts) 기준. ADMIN_LOGIN 은 시트에 없어
// 서버 소스 주석("문서는 추후 보강 예정")을 따른다.

// ADMIN_LOGIN 으로 보내는 값 (C->S). 계정 정보는 서버 .env(ADMIN_ID/ADMIN_PASSWORD)로만 관리한다 —
// 클라이언트 코드/문서에 하드코딩하지 않는다.
export interface AdminLoginPayload {
  id: string;
  password: string;
}

// ADMIN_LOGIN 응답 (S->C, 같은 type 재사용). 실패하면 서버가 바로 연결을 끊는다.
export interface AdminLoginResultPayload {
  result: "Y" | "N";
}

// ADMIN_CHANNEL_COUNT 로 보내는 값 (C->S). 2026-10-07 문서 변경: 어떤 게임의 채널 정보를 볼지 game 필드가 추가됐다.
export interface AdminChannelCountQuery {
  game: GameId;
}

// ADMIN_CHANNEL_COUNT 응답 (S->C, 같은 type 재사용) — 요청한 game 을 그대로 돌려준다.
// count 의 키는 room_name(lobby_1, rps_1 등 — 2026-10-07 게임 채널 이름이 game_N 에서 게임명_N 으로 바뀜),
// 값은 그 채널의 현재 접속자 수(CCU).
export interface AdminChannelCountPayload {
  game: GameId;
  count: Record<string, number>;
}

// ADMIN_CHANNEL_USER 로 보내는 값 (C->S). 2026-10-07 문서 변경: 예전 {lobby:N}/{game:N} 대신
// game(게임 종류) + channel(room_name 형식, 예: "lobby_1") 로 바뀌었다.
// 문서 G5 는 처음 "lobby1" 이었다가 2026-10-07 "lobby_1"(COUNT 응답 키/SEND_NOTICE channel 과 같은 형식)로 정정됐다.
export interface AdminChannelUserQuery {
  game: GameId;
  channel: string;
}

// room 은 게임 채널일 때만 채워진다(로비는 방 개념이 없음). 문서 예시는 숫자(room:1)라 둘 다 허용한다.
export interface AdminChannelUserEntry {
  userid: string;
  room?: string | number;
}

// ADMIN_CHANNEL_USER 응답 (S->C, 같은 type 재사용) — 요청받은 game/channel 을 그대로 돌려주고
// 유저 목록과 total(해당 채널의 유저 전체 숫자)을 채운다.
// 2026-10-07 문서 C6 가 잠시 목록 키를 `count` 로 적었다가 `user` 로 확정됐다.
export interface AdminChannelUserResultPayload extends AdminChannelUserQuery {
  user: AdminChannelUserEntry[];
  total: number;
}

// SEND_NOTICE 의 time — 공지를 띄울 시작/종료 시각. start/end 는 "HH:MM"(10분 단위), mon/day 는 날짜.
export interface SendNoticeTime {
  mon: number;
  day: number;
  start: string;
  end: string;
}

// SEND_NOTICE 로 보내는 값 (C->S, 응답 없음 — 발사 후 잊기). 2026-10-07 문서 변경: game 필드가 추가됐다.
// channel 은 공지를 받을 채널 이름 목록(예: ["lobby_1","lobby_2","rps_1","rps_2","othello_1"]).
export interface SendNoticePayload {
  game: GameId;
  time: SendNoticeTime;
  channel: string[];
  message: string;
}

// SEND_NOTICE 로 받는 값 (S->C, 같은 type 재사용) — 로비/게임 채널의 모든 유저에게 관리자 공지가 온다.
export interface NoticePayload {
  message: string;
}
