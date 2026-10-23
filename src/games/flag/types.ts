// 청기백기(flag) 전용 프로토콜 타입 — 혼자 하는 게임(1인). 방 입장/준비/퇴장/재시작 같은 공통 메시지는 common/types.ts 에 있다.
// 기준 문서: d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx ("flag" 시트)
// 서버 쪽 원본: server_ruflo/src/game/flag/flagTypes.ts, flagConstants.ts — 시트에 없는 확장
// (ONE_START 의 no/total, QUEST_SHOW 의 time, ONE_RESULT 의 score/answer, GAME_RESULT 의 correct_count/win_per)은 서버 소스 기준이다.
//
// b = 청기, w = 백기. 손 방향은 **오리 기준**이다(2026-10-22 사용자 변경): 오리 오른손 = 청기, 왼손 = 백기.
// 오리는 화면을 보고 서 있으므로 화면에서는 청기가 왼쪽, 백기가 오른쪽이다. 서버는 b/w 값만 판정하고 화면 방향은 모른다.
import type { RoomPlayerInfo } from "../../common/types";

export const FlagMessageType = {
  ONE_START: "ONE_START", // S->C {no, total} — 한 문제 시작. 1초 뒤 QUEST_SHOW
  // S->C {quest, say, time} 문제 / C->S {quest} 답 — 같은 type 을 양방향으로 쓴다
  QUEST_SHOW: "QUEST_SHOW",
  ONE_RESULT: "ONE_RESULT", // S->C {quest:"Y"/"N", score, answer} — 한 문제 결과. 5문제 전이면 2초 뒤 다음 ONE_START
} as const;
export type FlagMessageType = (typeof FlagMessageType)[keyof typeof FlagMessageType];

// 깃발 상태 값 — 1 올림, 0 정지, -1 내림. 답에서 0 은 정지 버튼을 누른 것이다.
export type FlagMove = -1 | 0 | 1;
export const FLAG_DOWN = -1;
export const FLAG_KEEP = 0;
export const FLAG_UP = 1;

// 어느 깃발인지 — b = 청기(오리 오른손, 화면 왼쪽), w = 백기(오리 왼손, 화면 오른쪽).
export type FlagSide = "b" | "w";

export interface FlagQuest {
  b: FlagMove;
  w: FlagMove;
}

// 문제 문구 코드 (서버 server_ruflo flagTypes.ts FlagSayCode). 문장과 판정 모두 이 코드로 한다(서버 flagRules.IsCorrect).
// "up" 올려 → 올림 / "down" 내려 → 내림 / "no_up" 올리지마 → 내림·정지 / "no_down" 내리지마 → 올림·정지 /
// "" 말 안 함 → 안 누름·정지. quest 는 대표 정답 포즈일 뿐이다.
// 예: quest {b:1, w:0} 는 "청기 올려, 백기 올리지마" / "청기 올려, 백기 내리지마" / "청기 올려" 로 나올 수 있다.
export type FlagSayCode = "up" | "down" | "no_up" | "no_down" | "";

export interface FlagSay {
  b: FlagSayCode;
  w: FlagSayCode;
}

// ENTER_ROOM 으로 받는 값 (S->C) — 혼자라 player2 가 없다(서버가 생략).
export interface FlagEnterRoomPayload {
  result: "Y" | "N";
  room: string;
  player1: RoomPlayerInfo;
}

// ONE_START 로 받는 값 (S->C). no = 몇 번째 문제(1부터), total = 전체 문제 수(5).
export interface FlagOneStartPayload {
  no: number;
  total: number;
}

// QUEST_SHOW 로 받는 값 (S->C). time = 답할 수 있는 초(5). say = 문제 문구 코드.
// quest 가 {0,0}(양손 정지)인 문제도 나온다 — 문제에 나온 깃발은 정지 버튼을 눌러야 정답이다.
export interface FlagQuestShowPayload {
  quest: FlagQuest;
  say: FlagSay;
  time: number;
}

// QUEST_SHOW 로 보내는 값 (C->S, 시트 flag H10) — 1 올림 / 0 정지 버튼 / -1 내림, 누르지 않은 깃발은 키를 뺀다.
// 예) {quest:{b:1, w:0}} = 청기 올림 + 백기 정지, {quest:{b:1}} = 청기 올림만(백기 안 누름).
// 문제에 나온 깃발 수만큼 버튼을 받은 뒤 한 번에 보낸다 — 서버는 처음 온 답 하나로 바로 ONE_RESULT 를 보내고 그 뒤 답은 무시한다.
export interface FlagAnswerPayload {
  quest: { b?: FlagMove; w?: FlagMove };
}

// 서버가 판정에 쓴 답 — null = 누르지 않은 깃발(시간 초과면 둘 다 null), 0 = 정지 버튼.
export interface FlagAnswer {
  b: FlagMove | null;
  w: FlagMove | null;
}

// ONE_RESULT 로 받는 값 (S->C). score = 지금까지 누적 점수, answer = 서버가 판정에 쓴 최종 답.
export interface FlagOneResultPayload {
  quest: "Y" | "N";
  score: number;
  answer: FlagAnswer;
}

// GAME_RESULT 로 받는 값 (S->C) — 마지막 ONE_RESULT 3초 뒤.
// score = 맞춘 수 × 5, win_per = 이번 결과까지 반영한 정답률(누적 맞춘 수 / (게임 수 × 5)).
export interface FlagGameResultPayload {
  score: number;
  correct_count: number;
  win_per: number;
}
