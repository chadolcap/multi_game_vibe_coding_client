// 서버와 미리 약속된 네트워크 설정.
// 서버 쪽 원본: server/src/common/config.ts, server/src/common/constants.ts
// 로비 채널 주소/포트는 서버가 따로 알려주지 않으므로 클라이언트에 고정해 둔다.

export const NETWORK_CONFIG = {
  host: "localhost",
  use_tls: false, // 운영 환경에서는 true(wss) — 개발 환경 기본값(ws)과 동일하게 맞춘다
  // 개발 중에는 로비/게임 모두 채널 1만 띄우기로 함 — 채널 2 는 서버에서 아직 안 켬.
  // 운영 전환 시 [6011, 6012] 로 되돌리면 됨 (게임 채널은 서버가 seat_reservation.publicAddress 로
  // 알려주므로 클라이언트가 직접 다룰 필요 없음).
  lobby_ports: [6011],
  // 관리자(Watcher) 채널 포트. 서버 .env 의 WATCHER_PORT 와 맞춰야 한다(서버 기본값은 6000).
  watcher_port: 6001,
} as const;

export const LOBBY_CHANNEL_COUNT = NETWORK_CONFIG.lobby_ports.length;

// 디자인 해상도(세로 모바일 화면 기준). 실제 기기 화면 크기에 맞춰 이 비율로 스케일만 조정한다.
export const GAME_WIDTH = 720;
export const GAME_HEIGHT = 1280;
