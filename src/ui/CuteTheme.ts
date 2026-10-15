// 로비/가위바위보/오델로/점핑 공용 화면 컨셉(하늘색 셔츠·빨간 넥타이를 한 아기 오리 캐릭터) 색상표와 배경/이미지 도우미.
// 공용 UI 컴포넌트에는 CUTE_THEME 을 넘겨 같은 컨셉으로 그리게 한다.
import { Assets, Container, FillGradient, Graphics, Text, Texture } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT, POP_FONT_FAMILY } from "../config";
import type { UiTheme } from "./UiTheme";
import { AVATAR_SIZE } from "./PlayerPanel";

export const CUTE_COLOR = {
  sky_top: 0x9fd8ff,
  sky_bottom: 0xe6f6ff,
  cloud: 0xffffff,
  grass: 0xc9eeb0,
  grass_dark: 0xa8dc8a,
  cream: 0xfffaf0,
  orange: 0xffa62b,
  orange_dark: 0xd9800f,
  red: 0xff5a4e,
  shirt: 0x8cc8f5,
  shirt_dark: 0x3d86c6,
  brown: 0x5b3a1e,
  pink: 0xff8fab,
  yellow: 0xffc94d,
  mint: 0x6fd0a0,
} as const;

// Pixi 는 쉼표로 나눈 이름마다 따옴표를 붙여주므로 CSS 처럼 대체 폰트를 이어 쓸 수 있다.
export const CUTE_FONT_FAMILY = `${POP_FONT_FAMILY}, sans-serif`;

export const CUTE_THEME: UiTheme = {
  font_family: CUTE_FONT_FAMILY,
  content_font_family: CUTE_FONT_FAMILY,
  text_color: CUTE_COLOR.brown,
  title_color: 0xff8a1f,
  accent_color: CUTE_COLOR.red,
  dim_alpha: 0.35,
  panel_color: CUTE_COLOR.cream,
  panel_border_color: CUTE_COLOR.shirt,
  panel_radius: 32,
  banner_bar_color: 0xfff3c4,
  button_idle_color: CUTE_COLOR.orange,
  button_hover_color: 0xffb94f,
  button_disabled_color: 0xcfc6b8,
  button_text_color: 0xffffff,
  button_radius: 28,
  button_shadow_color: CUTE_COLOR.orange_dark,
  label_color: CUTE_COLOR.shirt_dark,
  value_color: CUTE_COLOR.brown,
  avatar_color: 0xdff1ff,
  avatar_text_color: CUTE_COLOR.shirt_dark,
  error_color: CUTE_COLOR.red,
  input_color: 0xffffff,
  input_border_color: CUTE_COLOR.shirt,
  input_text_color: CUTE_COLOR.brown,
  spinner_color: CUTE_COLOR.orange,
};

// SVG 는 지정한 해상도로 래스터화되므로, 크게 띄워도 흐려지지 않게 2배로 불러온다.
export function LoadCuteTexture(url: string): Promise<Texture> {
  return Assets.load<Texture>({ src: url, data: { resolution: 2 } });
}

// 하늘(그라데이션) + 구름 + 땡땡이 + 아래쪽 풀밭 언덕. 720x1280 전체를 덮는다.
export function CreateCuteBackground(): Container {
  const background = new Container();

  const sky_gradient = new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: CUTE_COLOR.sky_top },
      { offset: 1, color: CUTE_COLOR.sky_bottom },
    ],
  });
  const sky = new Graphics().rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill(sky_gradient);

  // 은은한 땡땡이 무늬.
  const dots = new Graphics();
  for (let y = 40; y < GAME_HEIGHT; y += 80) {
    const offset_x = (y / 80) % 2 === 0 ? 40 : 0;
    for (let x = offset_x; x < GAME_WIDTH; x += 80) {
      dots.circle(x, y, 5);
    }
  }
  dots.fill({ color: 0xffffff, alpha: 0.35 });

  const clouds = new Graphics();
  DrawCloud(clouds, 110, 150, 1);
  DrawCloud(clouds, 610, 110, 0.8);
  DrawCloud(clouds, 640, 560, 0.7);
  DrawCloud(clouds, 70, 640, 0.6);
  // 구름 동그라미끼리 겹치는 부분이 진하게 보이지 않도록 불투명하게 채운다.
  clouds.fill(CUTE_COLOR.cloud);

  // 풀밭 언덕 두 겹 + 작은 꽃.
  const grass = new Graphics()
    .ellipse(150, GAME_HEIGHT + 60, 520, 330)
    .fill(CUTE_COLOR.grass_dark)
    .ellipse(560, GAME_HEIGHT + 90, 520, 320)
    .fill(CUTE_COLOR.grass);
  const flowers = new Graphics();
  for (const [x, y] of [[60, 1060], [200, 1210], [520, 1080], [660, 1190], [380, 1240]]) {
    for (let petal = 0; petal < 5; petal++) {
      const angle = (Math.PI * 2 * petal) / 5;
      flowers.circle(x + Math.cos(angle) * 7, y + Math.sin(angle) * 7, 6);
    }
  }
  flowers.fill(0xffffff);
  for (const [x, y] of [[60, 1060], [200, 1210], [520, 1080], [660, 1190], [380, 1240]]) {
    flowers.circle(x, y, 5);
  }
  flowers.fill(CUTE_COLOR.yellow);

  background.addChild(sky, dots, clouds, grass, flowers);
  return background;
}

// 동그라미 몇 개를 겹쳐 뭉게구름 모양을 만든다(채우기는 호출한 쪽에서 한 번에).
function DrawCloud(graphics: Graphics, x: number, y: number, scale: number): void {
  graphics
    .circle(x - 50 * scale, y + 10 * scale, 32 * scale)
    .circle(x, y - 10 * scale, 44 * scale)
    .circle(x + 50 * scale, y + 8 * scale, 34 * scale)
    .roundRect(x - 82 * scale, y + 6 * scale, 164 * scale, 36 * scale, 18 * scale);
}

// 사용자 정보 카드 — 아이디가 길어도 넘치지 않게 PlayerPanel(아바타 폭 AVATAR_SIZE)보다 넉넉히 그리고, 아바타는 카드 가운데에 둔다.
export const PLAYER_CARD_WIDTH = 290;
export const PLAYER_CARD_HEIGHT = 300;
export const PLAYER_CARD_PADDING_X = (PLAYER_CARD_WIDTH - AVATAR_SIZE) / 2;

// 사용자 정보(PlayerPanel) 뒤에 까는 카드 — 위쪽에 "상대"/"나" 이름표를 단다.
// PlayerPanel 은 카드 위치에서 (PLAYER_CARD_PADDING_X, 20) 만큼 안쪽에 두면 된다.
export function CreatePlayerCard(tag: string, tag_color: number): Container {
  const card = new Container();
  const background = new Graphics()
    .roundRect(0, 6, PLAYER_CARD_WIDTH, PLAYER_CARD_HEIGHT, 28)
    .fill({ color: 0x000000, alpha: 0.08 })
    .roundRect(0, 0, PLAYER_CARD_WIDTH, PLAYER_CARD_HEIGHT, 28)
    .fill(CUTE_COLOR.cream)
    .stroke({ color: tag_color, width: 5 });
  const tag_background = new Graphics().roundRect(PLAYER_CARD_WIDTH / 2 - 44, -22, 88, 38, 19).fill(tag_color);
  const tag_text = new Text({
    text: tag,
    style: { fill: 0xffffff, fontSize: 22, fontFamily: CUTE_FONT_FAMILY },
  });
  tag_text.anchor.set(0.5);
  tag_text.position.set(PLAYER_CARD_WIDTH / 2, -3);
  card.addChild(background, tag_background, tag_text);
  return card;
}
