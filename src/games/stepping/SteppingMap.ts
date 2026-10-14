// 점핑 맵 데이터. 서버는 MAP_SELECT 로 맵 번호(1~3)만 알려주므로, 블록 배치는 맵 번호별 고정 시드로
// 클라이언트가 만든다 — 같은 번호면 어느 클라이언트에서든 항상 똑같은 맵이 나와서 두 화면이 어긋나지 않는다.
//
// 좌표계: 시작 블록(0번) 윗면 중심이 (0,0) 인 월드 좌표(디자인 해상도 픽셀). 블록은 화면 위쪽(-y)으로
// 왼쪽 위/오른쪽 위 대각선 방향으로 하나씩 이어진다. 블록 위치 (x,y) 는 블록 **윗면의 중심**이고,
// MOVE_INFO 의 location 은 이 중심을 (0,0) 으로 한 착지 지점 좌표다.

export type SteppingBlockShape = "round" | "square";

export interface SteppingBlock {
  index: number; // 0 = 시작 블록, 1~block_count = MOVE_INFO 의 count
  x: number;
  y: number;
  // 윗면 반지름 — round 는 타원(rx, ry), square 는 가로 2rx · 세로 2ry 사각형.
  rx: number;
  ry: number;
  shape: SteppingBlockShape;
  // 디저트 색 조합 번호(SteppingView 의 BLOCK_STYLES). 시작/도착 블록은 따로 그린다.
  style: number;
}

export interface SteppingMap {
  map_no: number;
  // blocks[0] 은 시작 블록, blocks[block_count] 가 마지막(도착) 블록이다.
  blocks: SteppingBlock[];
  block_count: number;
}

interface MapSetting {
  seed: number;
  // ⚠️ 서버 steppingConstants.ts 의 STEPPING_MAP_BLOCK_COUNTS 와 같아야 한다 — 서버가 "모든 칸 완주"
  //    판정과 count 상한 검사에 쓴다. 서버 값은 아직 임시값(100)이라 그대로 맞춰 두었다.
  block_count: number;
  min_radius: number;
  max_radius: number;
  // 이웃한 두 블록 윗면 가장자리 사이 거리(중심 거리 = 두 반지름 + 간격).
  min_gap: number;
  max_gap: number;
  // 사각형 블록이 나올 확률.
  square_rate: number;
}

// 맵 번호가 클수록 블록이 작아지고 간격이 넓어져 어려워진다.
const MAP_SETTINGS: Record<number, MapSetting> = {
  1: { seed: 101, block_count: 100, min_radius: 48, max_radius: 58, min_gap: 12, max_gap: 52, square_rate: 0.25 },
  2: { seed: 202, block_count: 100, min_radius: 42, max_radius: 54, min_gap: 18, max_gap: 70, square_rate: 0.35 },
  3: { seed: 303, block_count: 100, min_radius: 36, max_radius: 48, min_gap: 24, max_gap: 86, square_rate: 0.45 },
};

export const STEPPING_BLOCK_STYLE_COUNT = 5;

// 블록 윗면의 세로 반지름 비율(위에서 비스듬히 내려다본 원근감).
const TOP_RATIO = 0.56;
// 블록이 이어지는 대각선 방향 — x 성분과 y 성분(위쪽이라 음수). 길이 1 로 정규화한 값.
export const PATH_DIR_X = 0.835;
export const PATH_DIR_Y = -0.55;
// 블록이 화면 가로로 너무 멀리 가지 않도록 x 를 이 범위 안에서만 지그재그로 움직인다.
const X_LIMIT = 105;

const map_cache = new Map<number, SteppingMap>();

// 맵 번호에 해당하는 맵. 모르는 번호면 1번 맵 설정으로 만든다(map_no 는 받은 번호 그대로 둔다).
export function GetSteppingMap(map_no: number): SteppingMap {
  const cached = map_cache.get(map_no);
  if (cached) return cached;

  const setting = MAP_SETTINGS[map_no] ?? MAP_SETTINGS[1];
  const random = CreateRandom(setting.seed);
  const blocks: SteppingBlock[] = [{ index: 0, x: 0, y: 0, rx: 60, ry: 60 * TOP_RATIO, shape: "round", style: 0 }];

  for (let index = 1; index <= setting.block_count; index++) {
    const prev = blocks[index - 1];
    const is_last = index === setting.block_count;
    const rx = is_last ? setting.max_radius + 4 : Lerp(setting.min_radius, setting.max_radius, random());
    const shape: SteppingBlockShape = !is_last && random() < setting.square_rate ? "square" : "round";
    const gap = Lerp(setting.min_gap, setting.max_gap, random());
    const distance = prev.rx + rx + gap;

    // 왼쪽/오른쪽은 무작위로 고르되, 가로 범위를 넘어가면 반대쪽으로 꺾는다.
    let side = random() < 0.5 ? -1 : 1;
    if (prev.x + side * distance * PATH_DIR_X > X_LIMIT) side = -1;
    if (prev.x + side * distance * PATH_DIR_X < -X_LIMIT) side = 1;

    blocks.push({
      index,
      x: Math.round(prev.x + side * distance * PATH_DIR_X),
      y: Math.round(prev.y + distance * PATH_DIR_Y),
      rx: Math.round(rx),
      ry: Math.round(rx * TOP_RATIO),
      shape,
      style: Math.floor(random() * STEPPING_BLOCK_STYLE_COUNT),
    });
  }

  const map: SteppingMap = { map_no, blocks, block_count: setting.block_count };
  map_cache.set(map_no, map);
  return map;
}

// 블록 중심 기준 좌표(local)가 그 블록 윗면 안인지. 윗면 가장자리에 걸친 것도 착지로 본다.
export function IsInsideBlock(block: SteppingBlock, local_x: number, local_y: number): boolean {
  if (block.shape === "square") return Math.abs(local_x) <= block.rx && Math.abs(local_y) <= block.ry;
  return (local_x / block.rx) ** 2 + (local_y / block.ry) ** 2 <= 1;
}

// 블록 중심에서 얼마나 가까운지(0 = 정중앙, 1 = 가장자리). PERFECT 판정에 쓴다.
export function GetCenterRatio(block: SteppingBlock, local_x: number, local_y: number): number {
  if (block.shape === "square") return Math.max(Math.abs(local_x) / block.rx, Math.abs(local_y) / block.ry);
  return Math.sqrt((local_x / block.rx) ** 2 + (local_y / block.ry) ** 2);
}

function Lerp(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio;
}

// 시드 고정 난수(mulberry32) — 같은 시드면 어느 브라우저에서든 같은 수열이 나온다.
function CreateRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
