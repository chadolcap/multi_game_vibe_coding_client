// 점핑(stepping) 전용 프로토콜 타입. 방 입장/준비/퇴장/재시작 같은 게임 공통 메시지는 common/types.ts 에 있다.
// 기준 문서: d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx ("stepping" 시트)
// 서버 쪽 원본: server_ruflo/src/game/stepping/steppingTypes.ts — 시트에 없는 확장(MOVE_INFO 의 life,
// GAME_RESULT 의 score/life/draw, 점핑용 GAME_STATUS)과 시트 오타(MAP_SEELCT)는 서버 소스 주석 기준이다.

export const SteppingMessageType = {
  // S->C {map} — 양쪽 READY 후 이번 게임의 맵 번호(1~3). 시트에는 MAP_SEELCT 로 오타가 나 있고,
  // 서버 와이어 이름은 MAP_SELECT 다(서버 types.ts 주석).
  MAP_SELECT: "MAP_SELECT",
  GAME_REMAIN_TIME: "GAME_REMAIN_TIME", // S->C {count} — GAME_START 이후 남은 초(1초마다). 총 시간은 서버 STEPPING_GAME_TIME_SEC(시트 20초 → 서버 60초)
  // C->S {count, location, save} / S->C 같은 type 에 userid, life 를 붙여 **양쪽 모두에게** 중계한다.
  MOVE_INFO: "MOVE_INFO",
  GAME_STATUS: "GAME_STATUS", // S->C {map, count?, player1, player2} — 게임 중 재접속한 당사자에게만
} as const;
export type SteppingMessageType = (typeof SteppingMessageType)[keyof typeof SteppingMessageType];

// 칸(블록) 안의 좌표. 각 블록 이미지의 중심이 (0,0) 이다 — 단위는 720x1280 디자인 해상도의 픽셀.
export interface SteppingPoint {
  x: number;
  y: number;
}

export type SteppingSave = "yes" | "no";

// MAP_SELECT 로 받는 값 (S->C).
export interface SteppingMapSelectPayload {
  map: number;
}

// GAME_REMAIN_TIME 로 받는 값 (S->C).
export interface SteppingRemainTimePayload {
  count: number;
}

// MOVE_INFO 로 보내는 값 (C->S) — 점프 한 번의 결과.
//   count:    이번 점프로 **도착하려던 칸 번호**(1부터). 서버는 "직전에 성공한 칸 + 1" 만 받는다.
//             추락해도 같은 번호를 보낸다(4번 칸으로 뛰다 떨어지면 count:4, save:"no").
//   location: 도착 지점의 그 칸 중심 기준 좌표. 추락이면 노렸던 칸 중심 기준으로 어디에 떨어졌는지다.
//   save:     "yes" = 칸 안에 착지, "no" = 추락
export interface SteppingMoveInfoPayload {
  count: number;
  location: SteppingPoint;
  save: SteppingSave;
}

// MOVE_INFO 로 받는 값 (S->C). life 는 시트에 없는 서버 확장 — 추락 후 남은 라이프(서버 기준)다.
// 라이프가 0 인 상태에서 또 추락하면(save:"no", life:0) 탈락이고 서버가 곧 GAME_RESULT 를 보낸다.
export interface SteppingMoveInfoResultPayload {
  userid: string;
  count: number;
  location: SteppingPoint;
  save: SteppingSave;
  life: number;
}

// GAME_STATUS 의 플레이어 한 명 상태. count = 지금까지 성공한 칸 수, location = 마지막 착지 좌표
// (추락 후에는 서버가 (0,0) 으로 되돌려 둔다).
export interface SteppingPlayerStatus {
  userid: string;
  count: number;
  life: number;
  location: SteppingPoint;
}

// GAME_STATUS 로 받는 값 (S->C). 시트의 GAME_STATUS 행은 오델로 것이 복사돼 있어, 서버가 점핑용으로 새로
// 정한 모양이다(서버 steppingTypes.ts). count(남은 초)는 GAME_START 전(맵 연출 2초)이면 오지 않는다.
export interface SteppingGameStatusPayload {
  map: number;
  count?: number;
  player1: SteppingPlayerStatus;
  player2: SteppingPlayerStatus;
}

// GAME_RESULT 의 winner/loser. win_count 는 승리 횟수가 아니라 **이동한 칸 수**다.
// score(남은 라이프×10 + 칸 수×5)/life 는 시트에 없는 서버 확장 — 왜 이겼는지 결과 화면에 보여준다.
export interface SteppingGameResultPlayerInfo {
  userid: string;
  win_count: number;
  win_per: number;
  score: number;
  life: number;
}

// GAME_RESULT 로 받는 값 (S->C). draw:"Y" 면 winner/loser 는 승자/패자가 아니라 그냥 두 참가자다.
export interface SteppingGameResultPayload {
  winner: SteppingGameResultPlayerInfo;
  loser: SteppingGameResultPlayerInfo;
  draw?: "Y";
}
