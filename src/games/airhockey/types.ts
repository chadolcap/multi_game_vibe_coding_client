// 에어하키(airhockey) 전용 프로토콜 타입. 방 입장/준비/퇴장/재시작 같은 게임 공통 메시지는 common/types.ts 에 있다.
// 기준 문서: d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx ("airhockey" 시트)
// 서버 쪽 원본: server_ruflo/src/game/airhockey/airhockeyTypes.ts, airhockeyConstants.ts — 시트에 없는 확장
// (GAME_RESULT 의 draw, GAME_STATUS 의 win_count0/1)과 테이블 크기 값은 서버 소스 기준이다.
//
// 좌표계: 원점(0,0)이 테이블 **정중앙**(퍽 시작 위치), x 는 오른쪽, y 는 **위쪽**이 + 다(화면 좌표와 y 가 반대).
// 좌표는 항상 **받는/보내는 유저 기준**이라 내 골대가 아래(y < 0), 상대 골대가 위(y > 0)다 — 서버가 위쪽 유저에게는
// (x,y) → (-x,-y) 로 뒤집어 보내므로 클라이언트는 뒤집을 필요가 없다(시트: "상대방의 좌표는 내 좌표를 기준으로 반대 방향").

export const AirhockeyMessageType = {
  ONE_START: "ONE_START", // S->C (payload 없음) — 한 판(한 골) 시작. 퍽이 중앙에 멈춘 채로 놓인다(먼저 친 쪽이 선공)
  PUCK_MOVE: "PUCK_MOVE", // S->C {loc} — 서버가 계산한 퍽 위치. 움직이는 동안 30Hz, 멈춰 있으면 안 온다
  // C->S {loc} 내 레버 위치 / S->C {user, loc} 상대(또는 상대를 대신 조종하는 서버 봇) 레버 위치
  LEVER_MOVE: "LEVER_MOVE",
  ONE_RESULT: "ONE_RESULT", // S->C {win, win_count} — 골! win 은 골을 넣은 유저, win_count 는 그 유저의 누적 골 수
  GAME_STATUS: "GAME_STATUS", // S->C — 게임 중 재접속한 당사자에게만
} as const;
export type AirhockeyMessageType = (typeof AirhockeyMessageType)[keyof typeof AirhockeyMessageType];

// ⚠️ 테이블/퍽/레버 크기는 서버 airhockeyConstants.ts 와 반드시 같아야 한다 — 서버가 이 크기로 충돌을 계산하므로
//    다르면 화면에서는 안 닿았는데 튕기거나, 닿았는데 통과한다. 서버 값이 "임시"라 바뀌면 여기도 같이 바꾼다.
//    화면에는 이 논리 크기를 통째로 줄여서 그린다(AirhockeyTable 의 TABLE_SCALE).
export const AIRHOCKEY_TABLE_WIDTH = 720;
export const AIRHOCKEY_TABLE_HEIGHT = 1280;
export const AIRHOCKEY_GOAL_WIDTH = 260; // 위아래 벽 가운데의 골대 입구 폭
export const AIRHOCKEY_PUCK_RADIUS = 30;
export const AIRHOCKEY_LEVER_RADIUS = 60;
// 먼저 이만큼 골을 넣으면 승리(시트/사용자: "총 3점을 먼저 획득한 유저가 승자", 서버 AIRHOCKEY_WIN_GOALS).
export const AIRHOCKEY_WIN_GOALS = 3;

export interface AirhockeyPoint {
  x: number;
  y: number;
}

// LEVER_MOVE 로 보내는 값 (C->S) — 내 레버의 현재 위치(내 기준 좌표). 서버는 내 쪽 절반 안으로 잘라서 받는다.
export interface AirhockeyLeverMovePayload {
  loc: AirhockeyPoint;
}

// PUCK_MOVE 로 받는 값 (S->C).
export interface AirhockeyPuckMovePayload {
  loc: AirhockeyPoint;
}

// LEVER_MOVE 로 받는 값 (S->C) — 레버 주인이 아닌 쪽에만 온다(내 레버 위치는 내가 이미 안다).
export interface AirhockeyLeverMoveResultPayload {
  user: string;
  loc: AirhockeyPoint;
}

// ONE_RESULT 로 받는 값 (S->C).
export interface AirhockeyOneResultPayload {
  win: string;
  win_count: number;
}

// GAME_STATUS 로 받는 값 (S->C) — 받는 유저 기준 좌표.
//   LEVER0 / LEVER1: ENTER_ROOM 의 player1 / player2 레버(오델로 status0/status1 과 같은 순서 관례)
//   win_count0 / win_count1: player1 / player2 의 골 수 — 시트에 없는 서버 확장(재접속 후 점수판 복원용)
export interface AirhockeyGameStatusPayload {
  puck: { loc: AirhockeyPoint };
  LEVER0: AirhockeyPoint;
  LEVER1: AirhockeyPoint;
  win_count0?: number;
  win_count1?: number;
}

// GAME_RESULT 의 winner/loser. win_count 는 **넣은 골 수**, score 는 이번 게임 랭킹 점수(골 수 × 5).
export interface AirhockeyGameResultPlayerInfo {
  userid: string;
  win_count: number;
  score: number;
  win_per: number;
}

// GAME_RESULT 로 받는 값 (S->C). draw:"Y" 는 둘 다 나갔는데 골 수가 같을 때만 생긴다(시트에 없는 서버 확장).
// 2026-10-15 사용자 결정: GAME_INVALID(퍽 정체 반복으로 게임 중단) 프로토콜은 없애고, 그 경우도 GAME_RESULT 에
// draw:"Y" 로 알린다. 통신 문서처럼 draw 는 "Y"(무승부/무효) 또는 "N"(승패 있음)이고, 이때 winner/loser 는 그냥
// 두 참가자다. 예전 서버처럼 draw 가 빠져 오면 "N" 으로 본다.
export interface AirhockeyGameResultPayload {
  winner: AirhockeyGameResultPlayerInfo;
  loser: AirhockeyGameResultPlayerInfo;
  draw?: "Y" | "N";
}
