// 공용 UI 컴포넌트(Button/PlayerPanel/배너/팝업)의 색·폰트 묶음.
// 게임마다 화면 컨셉이 달라 같은 컴포넌트를 다른 색으로 쓰기 위해 둔다 — 지금은 로비와 모든 게임 씬이
// CUTE_THEME 을 넘긴다. 기존 어두운 기본 테마(DEFAULT_UI_THEME)는 아무도 쓰지 않아 없애고, 테마를 필수 인자로 받는다.
import { Graphics } from "pixi.js";

export interface UiTheme {
  font_family: string;
  // 결과 수치처럼 줄 맞춤이 필요한 본문 폰트 (예전 기본 테마는 monospace, CUTE_THEME 은 제목과 같은 폰트).
  content_font_family: string;
  text_color: number;
  title_color: number;
  // 승자 문구, 게임별 덧붙임 표기(PlayerPanel.SetNote) 같은 강조색.
  accent_color: number;
  dim_alpha: number;
  panel_color: number;
  // 팝업 패널 테두리 — null 이면 그리지 않는다.
  panel_border_color: number | null;
  panel_radius: number;
  banner_bar_color: number;
  button_idle_color: number;
  button_hover_color: number;
  button_disabled_color: number;
  button_text_color: number;
  button_radius: number;
  // 버튼 아래쪽에 깔리는 입체감용 그림자 — null 이면 그리지 않는다.
  button_shadow_color: number | null;
  // PlayerPanel 표기: 명칭(아이디/별명/승율)과 실제 데이터를 다른 색으로 구분한다.
  label_color: number;
  value_color: number;
  avatar_color: number;
  avatar_text_color: number;
  // 오류/경고 문구(별명 등록 실패, 서버 연결 끊김 제목 등).
  error_color: number;
  // 입력창/선택 상자(별명 입력, 로비 게임 선택) 바탕·테두리·글자색.
  input_color: number;
  input_border_color: number;
  input_text_color: number;
  // 로딩 화면의 빙글빙글 도는 표시 색.
  spinner_color: number;
}

// 팝업 패널 테두리 두께.
const PANEL_BORDER_WIDTH = 6;

// 0xRRGGBB 숫자 색을 HTML 오버레이(<input>/<select>) 스타일에 쓰는 "#rrggbb" 문자열로 바꾼다.
export function ToCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

// 팝업 패널(둥근 사각형 + 테마에 테두리 색이 있으면 테두리)을 그린다 — 팝업들이 같은 모양을 쓰도록 한곳에 둔다.
export function DrawThemedPanel(x: number, y: number, width: number, height: number, theme: UiTheme): Graphics {
  const panel = new Graphics().roundRect(x, y, width, height, theme.panel_radius).fill(theme.panel_color);
  if (theme.panel_border_color !== null) panel.stroke({ color: theme.panel_border_color, width: PANEL_BORDER_WIDTH });
  return panel;
}
