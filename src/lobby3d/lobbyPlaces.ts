// 로비 1번 섬(입구)의 건물 배치표 — 기획 배치도의 원 중심을 (0,0), 반지름을 ISLAND_RADIUS 로 옮긴 값이다.
// x 는 오른쪽, z 는 화면 아래쪽(매표소 쪽)이 + 이다.
// ⚠️ 건물 → 게임 연결(action)은 임시 배정이다. 2~5번 섬 기획이 나오면 이 표만 고치면 된다.
import { GameId } from "../common/types";

export const ISLAND_RADIUS = 30;
// 오리가 걸어 다닐 수 있는 섬 안쪽 반지름 (해변으로 빠지지 않게 가장자리보다 조금 작다)
export const WALK_RADIUS = 28.6;
// 접속하면 서 있는 자리 — 매표소 바로 앞
export const PLAYER_START = { x: 0, z: 27.2 } as const;
export const TICKET_GATE = { x: 0, z: 22.6, half_width: 2 } as const;

export type LobbyPlaceAction = { kind: "game"; game: GameId } | { kind: "info" };

export type LobbyPlaceKind = "statue" | "cafe_green" | "cafe_red" | "doll_shop" | "toy_shop" | "food_truck" | "restroom";

export interface LobbyPlace {
  id: string;
  label: string;
  kind: LobbyPlaceKind;
  x: number;
  z: number;
  // 오리가 통과하지 못하는 반지름
  collide_radius: number;
  // 없으면 들어갈 수 없는 건물이다
  action?: LobbyPlaceAction;
}

export const LOBBY_PLACES: LobbyPlace[] = [
  { id: "statue", label: "오리 분수", kind: "statue", x: 0, z: 0, collide_radius: 6.2, action: { kind: "info" } },
  { id: "starbucks", label: "스타벅스", kind: "cafe_green", x: 15.5, z: 7.8, collide_radius: 4.8, action: { kind: "game", game: GameId.RPS } },
  { id: "twosome", label: "투썸플레이스", kind: "cafe_red", x: 13.6, z: -8.6, collide_radius: 4.5, action: { kind: "game", game: GameId.OTHELLO } },
  { id: "doll_shop", label: "인형 굿즈샵", kind: "doll_shop", x: -18.2, z: -8.6, collide_radius: 4.8, action: { kind: "game", game: GameId.AIRHOCKEY } },
  { id: "toy_shop", label: "장난감 굿즈샵", kind: "toy_shop", x: -18.7, z: 7.8, collide_radius: 4.8, action: { kind: "game", game: GameId.STEPPING } },
  { id: "food_truck", label: "솜사탕 푸드트럭", kind: "food_truck", x: -5.1, z: -21.4, collide_radius: 3.6, action: { kind: "game", game: GameId.FLAG } },
  { id: "restroom", label: "화장실", kind: "restroom", x: 12.3, z: -19.3, collide_radius: 2.6 },
];

// 다리 2개 — 2~5번 섬이 생기기 전까지는 공사 중으로 막아 둔다.
export const LOBBY_BRIDGES = [
  { from: { x: -16, z: -21 }, to: { x: -27, z: -32 } },
  { from: { x: 16.8, z: -19.7 }, to: { x: 31, z: -27.5 } },
] as const;

// 매표소 건물 양옆은 막혀 있고 가운데 게이트(TICKET_GATE)로만 지나간다.
export const TICKET_BOOTH_OBSTACLES = [
  { x: -5.2, z: 22.6, radius: 3.2 },
  { x: -10.4, z: 22.6, radius: 3.2 },
  { x: 5.2, z: 22.6, radius: 3.2 },
  { x: 10.4, z: 22.6, radius: 3.2 },
] as const;
