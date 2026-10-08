// 가위바위보 전용 프로토콜 타입. 방 입장/준비/결과 같은 게임 공통 메시지는 common/types.ts 에 있다.
// 기준 문서: d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx ("통신규약" 시트)

export const RpsMessageType = {
  ONE_START: "ONE_START", // S->C (한 판 시작)
  ONE_REMAIN_TIME: "ONE_REMAIN_TIME", // S->C (한 판 남은 시간, 1초 단위. count:0 이면 선택 종료)
  SELECT_GAME: "SELECT_GAME", // C->S (가위/바위/보 선택)
  ONE_RESULT: "ONE_RESULT", // S->C (한 판 결과)
} as const;
export type RpsMessageType = (typeof RpsMessageType)[keyof typeof RpsMessageType];

// ONE_START 로 받는 값 (S->C). count 는 이 판의 선택 제한(초) 값 — 표시는 ONE_REMAIN_TIME 이 대신 맡는다.
export interface OneStartPayload {
  count: number;
}

// ONE_REMAIN_TIME 로 받는 값 (S->C). ONE_START 이후 선택 제한 남은 초를 1초 단위로 전달한다.
// count 가 0 이면 선택 시간이 끝났다는 신호(그 판은 자동 선택으로 마무리됨).
export interface OneRemainTimePayload {
  count: number;
}

// SELECT_GAME 으로 보내는 값 (C->S)
export const RpsChoice = {
  ROCK: "바위",
  SCISSORS: "가위",
  PAPER: "보",
} as const;
export type RpsChoice = (typeof RpsChoice)[keyof typeof RpsChoice];

export interface SelectGamePayload {
  select: RpsChoice;
}

// ONE_RESULT 로 받는 값 (S->C). win 은 승자 userid — 무승부면 서버가 필드 자체를 생략한다.
export interface OneResultPayload {
  player1: RpsChoice;
  player2: RpsChoice;
  win?: string;
}
