// 오델로 전용 프로토콜 타입. 방 입장/준비/퇴장/재시작 같은 게임 공통 메시지는 common/types.ts 에 있다.
// 기준 문서: d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx ("othello" 시트)
// 서버 쪽 원본: server_ruflo/src/game/othello/othelloTypes.ts — 시트에 없는 확장(can, draw)과
// 시트 예시와 다른 값(win_count 의미)은 서버 소스 주석 기준이다.

export const OthelloMessageType = {
  DOLL_SELECT: "DOLL_SELECT", // C->S {color} / S->C {select:{색:userid}} — 같은 type 재사용
  DOLL_SELECT_REMAIN_TIME: "DOLL_SELECT_REMAIN_TIME", // S->C {count} — 돌 선택 남은 초
  TURN_START: "TURN_START", // S->C {turn, can} — 돌을 놓을 유저와 놓을 수 있는 자리
  TURN_REMAIN_TIME: "TURN_REMAIN_TIME", // S->C {count} — 턴 남은 초(1초 단위)
  SELECT_GAME: "SELECT_GAME", // C->S {select:{x,y}} / S->C {select:{userid,x,y}, change} — 같은 type 재사용
  GAME_STATUS: "GAME_STATUS", // S->C {select, status0, status1} — 게임 중 같은 방으로 재접속한 당사자에게만 현재 상태 전달
} as const;
export type OthelloMessageType = (typeof OthelloMessageType)[keyof typeof OthelloMessageType];

// 돌 색. 시트 기준 0=흰색, 1=검정. 오델로 표준 규칙상 검정(1)이 선공이다.
export const OthelloColor = {
  WHITE: 0,
  BLACK: 1,
} as const;
export type OthelloColor = (typeof OthelloColor)[keyof typeof OthelloColor];

// 좌표는 0~7(0-based) — 와이어 프로토콜도 같은 기준이다(서버 확인, 2026-10-07).
export interface OthelloPoint {
  x: number;
  y: number;
}

// DOLL_SELECT 로 보내는 값 (C->S). 고르고 싶은 돌 색.
export interface OthelloDollSelectPayload {
  color: OthelloColor;
}

// DOLL_SELECT 로 받는 값 (S->C). 시트 예시 select:{0:userid1, 1:userid2} — 키가 돌 색, 값이 그 색을 가진 userid.
// 한쪽이 먼저 고르면 상대는 자동으로 반대 색이 되고, 시간 안에 아무도 안 고르면 서버가 랜덤 배정한다.
export interface OthelloDollSelectResultPayload {
  select: Record<string, string>;
}

// DOLL_SELECT_REMAIN_TIME / TURN_REMAIN_TIME 로 받는 값 (S->C).
export interface OthelloRemainTimePayload {
  count: number;
}

// TURN_START 로 받는 값 (S->C). can 은 시트에 없는 서버 확장 — 이 턴에 놓을 수 있는 자리 목록이다.
// 별도 PASS 메시지는 없다: turn 이 같은 유저로 연속해서 오면 상대가 놓을 곳이 없어 패스한 것이다.
export interface OthelloTurnStartPayload {
  turn: string;
  can: OthelloPoint[];
}

// SELECT_GAME 으로 보내는 값 (C->S). 돌을 놓을 자리. 10초 안에 안 보내면 서버가 합법수 중 랜덤으로 둔다.
export interface OthelloSelectGamePayload {
  select: OthelloPoint;
}

// SELECT_GAME 으로 받는 값 (S->C). 누가 어디에 놓았고, 그 돌 때문에 뒤집히는 돌의 좌표(change)가 온다.
// 이 결과 2초 뒤에 다음 TURN_START 가 온다.
export interface OthelloSelectGameResultPayload {
  select: { userid: string; x: number; y: number };
  change: OthelloPoint[];
}

// GAME_STATUS 로 받는 값 (S->C, 2026-10-08 문서 추가). 게임 중 같은 방으로 재접속한 유저 본인에게만 온다.
// select 는 DOLL_SELECT 결과와 같은 {색: userid}, status0/status1 은 흰색(0)/검정(1) 돌이 놓여 있는 좌표 목록이다.
// 재접속 유저는 진행 중인 판의 돌 색과 보드를 이 메시지로만 복원할 수 있다.
// turn/can 은 2026-10-08 문서에 추가됐다 — 지금 돌을 놓을 차례인 유저와 그 유저가 놓을 수 있는 자리(TURN_START 와 같은 의미).
// 재접속 직후에는 TURN_START 를 다시 받지 못하므로, 내 차례였다면 이걸로 이어서 둘 수 있다.
// 차례가 없는 구간(돌 색 선택 중, 착수 결과 직후 2초 등)에는 오지 않을 수 있어 optional 로 둔다.
export interface OthelloGameStatusPayload {
  select: Record<string, string>;
  status0: OthelloPoint[];
  status1: OthelloPoint[];
  turn?: string;
  can?: OthelloPoint[];
}

// GAME_RESULT 로 받는 값 (S->C). 공통 GameResultPayload 와 모양은 같지만 의미가 다르다:
// - win_count 는 승리 횟수가 아니라 최종 돌 개수다(시트 예시의 2/1 은 가위바위보 값이 복사된 흔적).
// - draw:"Y" 는 시트에 없는 서버 확장 — 돌 개수가 같은 무승부면 오고, 이때 winner/loser 는 승자/패자가
//   아니라 그냥 두 참가자다.
export interface OthelloGameResultPayload {
  winner: { userid: string; win_count: number; win_per: number };
  loser: { userid: string; win_count: number; win_per: number };
  draw?: "Y";
}
