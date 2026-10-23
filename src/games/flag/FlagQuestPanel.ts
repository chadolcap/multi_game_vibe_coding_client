// 청기백기 화면 위쪽 문제 판넬 — "문제 n/5", 점수, 문제 문구("청기 올려!"), 남은 시간 막대를 보여준다.
// 서버/네트워크는 모르고, 씬이 받은 값을 넣어 주면 그리기만 한다.
// 남은 시간 막대는 연출일 뿐이다 — 판정 시각은 서버가 정한다(ONE_RESULT 가 오면 막대를 멈춘다).
// 좌표 기준점(0,0)은 판넬 왼쪽 위다.
import { Container, Graphics, Text, Ticker } from "pixi.js";
import { CUTE_COLOR, CUTE_FONT_FAMILY } from "../../ui/CuteTheme";
import type { FlagSay, FlagSayCode } from "./types";

export const FLAG_QUEST_PANEL_WIDTH = 660;
export const FLAG_QUEST_PANEL_HEIGHT = 250;

const PADDING_X = 28;
const TIME_BAR_HEIGHT = 18;
const TIME_BAR_Y = FLAG_QUEST_PANEL_HEIGHT - 40;
const TIME_BAR_WIDTH = FLAG_QUEST_PANEL_WIDTH - PADDING_X * 2;
// 문제가 나올 때 문구가 톡 튀어나오는 시간.
const QUEST_POP_MS = 260;

// 문제 문구 색 — 청기 줄은 파랑, 백기 줄은 갈색(흰 판넬 위라 흰색은 안 보인다).
const BLUE_TEXT_COLOR = 0x1f5fe0;

export class FlagQuestPanel extends Container {
  private readonly progress_text: Text;
  private readonly score_text: Text;
  // 문제 문구 — 한 줄(한쪽 명령) 또는 두 줄(양쪽 명령). 줄마다 깃발 색을 다르게 쓴다.
  private readonly quest_lines: [Text, Text];
  private readonly quest_box = new Container();
  private readonly time_bar = new Graphics();
  private readonly border = new Graphics();
  private time_total_ms = 0;
  private time_left_ms = 0;
  private timer_running = false;
  private quest_elapsed_ms = Number.POSITIVE_INFINITY;

  constructor() {
    super();

    const background = new Graphics()
      .roundRect(0, 8, FLAG_QUEST_PANEL_WIDTH, FLAG_QUEST_PANEL_HEIGHT, 32)
      .fill({ color: 0x000000, alpha: 0.1 })
      .roundRect(0, 0, FLAG_QUEST_PANEL_WIDTH, FLAG_QUEST_PANEL_HEIGHT, 32)
      .fill(CUTE_COLOR.cream);
    this.DrawBorder(CUTE_COLOR.orange);

    this.progress_text = new Text({
      text: "",
      style: { fill: CUTE_COLOR.brown, fontSize: 26, fontFamily: CUTE_FONT_FAMILY },
    });
    this.progress_text.position.set(PADDING_X, 18);

    this.score_text = new Text({
      text: "",
      style: { fill: CUTE_COLOR.orange_dark, fontSize: 26, fontFamily: CUTE_FONT_FAMILY },
    });
    this.score_text.anchor.set(1, 0);
    this.score_text.position.set(FLAG_QUEST_PANEL_WIDTH - PADDING_X, 18);

    const CreateLine = (): Text => {
      const line = new Text({
        text: "",
        style: {
          fill: CUTE_COLOR.brown,
          fontSize: 54,
          fontFamily: CUTE_FONT_FAMILY,
          stroke: { color: 0xffffff, width: 6, join: "round" },
        },
      });
      line.anchor.set(0.5);
      return line;
    };
    this.quest_lines = [CreateLine(), CreateLine()];
    this.quest_box.position.set(FLAG_QUEST_PANEL_WIDTH / 2, 122);
    this.quest_box.addChild(...this.quest_lines);

    this.addChild(background, this.border, this.progress_text, this.score_text, this.quest_box, this.time_bar);
    this.SetProgress(0, 0);
    this.SetScore(0);
    this.ShowMessage("");
    Ticker.shared.add(this.OnTick);
  }

  // "문제 n/total". no 가 0 이면(게임 시작 전) 비운다.
  public SetProgress(no: number, total: number): void {
    this.progress_text.text = no > 0 ? `문제 ${no}/${total}` : "";
  }

  public SetScore(score: number): void {
    this.score_text.text = `점수 ${score}`;
  }

  // 문제 대신 안내 문구(준비/결과 등)를 한 줄로 보여주고 남은 시간 막대를 숨긴다.
  public ShowMessage(message: string, color: number = CUTE_COLOR.brown): void {
    this.SetLines([{ text: message, color }]);
    this.StopTimer();
    this.time_bar.clear();
    this.DrawBorder(CUTE_COLOR.orange);
  }

  // 문제를 보여주고 time_sec 동안 줄어드는 시간 막대를 돌린다.
  // 문구는 서버가 정한 say 코드로 만든다 — 말하지 않는("") 깃발은 줄을 만들지 않는다.
  public ShowQuest(say: FlagSay, time_sec: number): void {
    const lines: { text: string; color: number }[] = [];
    if (say.b !== "") lines.push({ text: `청기 ${DescribeSay(say.b)}!`, color: BLUE_TEXT_COLOR });
    if (say.w !== "") lines.push({ text: `백기 ${DescribeSay(say.w)}!`, color: CUTE_COLOR.brown });
    this.SetLines(lines);
    this.quest_elapsed_ms = 0;
    this.DrawBorder(CUTE_COLOR.orange);

    this.time_total_ms = Math.max(0, time_sec) * 1000;
    this.time_left_ms = this.time_total_ms;
    this.timer_running = this.time_total_ms > 0;
    this.DrawTimeBar();
  }

  // 판정이 나왔다 — 막대를 멈추고 테두리 색으로 정답/오답을 알린다(문제 문구는 남겨 둔다).
  public ShowJudge(correct: boolean): void {
    this.StopTimer();
    this.DrawBorder(correct ? CUTE_COLOR.mint : CUTE_COLOR.red);
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  private StopTimer(): void {
    this.timer_running = false;
  }

  private SetLines(lines: { text: string; color: number }[]): void {
    const line_gap = 62;
    this.quest_lines.forEach((line, index) => {
      const info = lines[index];
      line.visible = info !== undefined;
      if (!info) return;
      line.text = info.text;
      line.style.fill = info.color;
      // 한 줄이면 가운데, 두 줄이면 위아래로 나눈다.
      line.y = lines.length === 1 ? 0 : (index - 0.5) * line_gap;
    });
  }

  private DrawBorder(color: number): void {
    this.border.clear().roundRect(0, 0, FLAG_QUEST_PANEL_WIDTH, FLAG_QUEST_PANEL_HEIGHT, 32).stroke({ color, width: 6 });
  }

  private DrawTimeBar(): void {
    const ratio = this.time_total_ms > 0 ? this.time_left_ms / this.time_total_ms : 0;
    // 시간이 얼마 안 남으면 빨갛게 바꾼다.
    const color = ratio > 0.35 ? CUTE_COLOR.mint : CUTE_COLOR.red;
    this.time_bar
      .clear()
      .roundRect(PADDING_X, TIME_BAR_Y, TIME_BAR_WIDTH, TIME_BAR_HEIGHT, TIME_BAR_HEIGHT / 2)
      .fill({ color: CUTE_COLOR.brown, alpha: 0.12 });
    if (ratio > 0) {
      this.time_bar
        .roundRect(PADDING_X, TIME_BAR_Y, Math.max(TIME_BAR_HEIGHT, TIME_BAR_WIDTH * ratio), TIME_BAR_HEIGHT, TIME_BAR_HEIGHT / 2)
        .fill(color);
    }
  }

  private readonly OnTick = (ticker: Ticker): void => {
    if (this.timer_running) {
      this.time_left_ms = Math.max(0, this.time_left_ms - ticker.deltaMS);
      this.DrawTimeBar();
      // 0 이 돼도 판정은 서버가 한다 — 막대만 멈추고 ONE_RESULT 를 기다린다.
      if (this.time_left_ms <= 0) this.timer_running = false;
    }

    if (this.quest_elapsed_ms < QUEST_POP_MS) {
      this.quest_elapsed_ms += ticker.deltaMS;
      const t = Math.min(1, this.quest_elapsed_ms / QUEST_POP_MS);
      this.quest_box.scale.set(0.6 + 0.4 * EaseOutBack(t));
    } else {
      this.quest_box.scale.set(1);
    }
  };
}

function DescribeSay(say: FlagSayCode): string {
  if (say === "up") return "올려";
  if (say === "down") return "내려";
  if (say === "no_up") return "올리지마";
  if (say === "no_down") return "내리지마";
  return "";
}

// 목표값을 살짝 넘었다가 돌아오는 이징(0~1).
function EaseOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
