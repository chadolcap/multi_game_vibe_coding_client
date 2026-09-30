// 채널 번호 -> 룸 이름 변환.
// 서버 쪽 원본: server/src/common/channelNames.ts (규칙이 바뀌면 양쪽을 함께 수정한다)

// 로비 룸 이름: lobby_1, lobby_2
export function GetLobbyRoomName(channel_no: number): string {
  return `lobby_${channel_no}`;
}
