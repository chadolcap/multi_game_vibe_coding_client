// 공용 UI 컴포넌트(Button/PlayerPanel/배너/팝업)의 색·폰트 묶음.
// 게임마다 화면 컨셉이 달라 같은 컴포넌트를 다른 색으로 쓰기 위해 둔다 — 지정하지 않으면
// DEFAULT_UI_THEME(기존 어두운 화면 그대로)을 쓰므로 로비/오델로 화면은 바뀌지 않는다.
export interface UiTheme {
  font_family: string;
  // 결과 수치처럼 줄 맞춤이 필요한 본문 폰트 (기본 테마는 monospace).
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
}

export const DEFAULT_UI_THEME: UiTheme = {
  font_family: "sans-serif",
  content_font_family: "monospace",
  text_color: 0xeaeaea,
  title_color: 0xffffff,
  accent_color: 0xffd257,
  dim_alpha: 0.6,
  panel_color: 0x22243a,
  panel_border_color: null,
  panel_radius: 16,
  banner_bar_color: 0x2f6feb,
  button_idle_color: 0x2f6feb,
  button_hover_color: 0x4c86f5,
  button_disabled_color: 0x555555,
  button_text_color: 0xffffff,
  button_radius: 8,
  button_shadow_color: null,
  label_color: 0x8fb8ff,
  value_color: 0xeaeaea,
  avatar_color: 0x2c2f4a,
  avatar_text_color: 0xffffff,
};
