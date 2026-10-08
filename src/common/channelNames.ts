// 채널 번호 -> 룸 이름 변환.
// 서버 쪽 원본: server/src/common/channelNames.ts (규칙이 바뀌면 양쪽을 함께 수정한다)

import { GameId } from "./types";

// 로비 룸 이름: lobby_1, lobby_2
export function GetLobbyRoomName(channel_no: number): string {
  return `lobby_${channel_no}`;
}

// 게임 룸 이름("rps_1", "othello_2")에서 게임 종류를 뽑는다. 게임 룸 이름이 아니면 undefined.
// MATCH_FOUND/REJOIN_GAME 처럼 "이 방이 어느 게임인지"를 room_name 으로만 알 수 있는 곳에서 쓴다.
// (서버 쪽 원본: ParseGameTypeFromRoomName)
export function ParseGameIdFromRoomName(room_name: string): GameId | undefined {
  const prefix = room_name.split("_")[0];
  return Object.values(GameId).find((game_id) => game_id === prefix);
}
