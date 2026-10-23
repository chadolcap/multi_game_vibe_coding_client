// 청기백기 게임방 씬 — 혼자 하는 게임. 씬이 만들어지면 바로 ENTER_ROOM 을 요청하고, 응답(player1 = 나)을 받으면
// '게임 시작' 버튼을 활성화한다. 준비가 끝나면
// GAME_START -> (ONE_START -> QUEST_SHOW -> 버튼으로 답 -> ONE_RESULT) x 5 -> GAME_RESULT 순으로 진행한다.
// 화면: 위쪽 문제 판넬, 가운데 깃발 든 오리, 오리 양옆 위/아래 화살표(왼쪽 = 청기 = 오리 오른손, 오른쪽 = 백기 = 오리 왼손).
// 게임 중 '나가기'를 누르면 방 연결을 끊는다 — 서버가 그때까지 맞춘 점수로 저장하고 방을 없앤다(재접속 없음).
import { Container, Text } from "pixi.js";
import type { Room } from "@colyseus/sdk";
import type { Scene } from "../../scenes/Scene";
import { Button } from "../../ui/Button";
import { CUTE_COLOR, CUTE_FONT_FAMILY, CUTE_THEME, CreateCuteBackground } from "../../ui/CuteTheme";
import { Confetti } from "../../ui/Confetti";
import { GameResultPopup, RESULT_SCREEN_DIM_ALPHA } from "../../ui/GameResultPopup";
import { GameStartBanner } from "../../ui/GameStartBanner";
import type { NoticeBanner } from "../../ui/NoticeBanner";
import { ConnectionLostPopup } from "../../ui/ConnectionLostPopup";
import { FlagConnection } from "./FlagConnection";
import { FlagDuck } from "./FlagDuck";
import { FlagControlPanel, FLAG_DOWN_BUTTON_CENTER_Y } from "./FlagControlPanel";
import { FlagQuestPanel, FLAG_QUEST_PANEL_WIDTH } from "./FlagQuestPanel";
import {
  FLAG_KEEP,
  FLAG_UP,
  type FlagAnswerPayload,
  type FlagEnterRoomPayload,
  type FlagGameResultPayload,
  type FlagMove,
  type FlagOneResultPayload,
  type FlagOneStartPayload,
  type FlagQuestShowPayload,
  type FlagSide,
} from "./types";

// 화면 배치(720x1280 기준).
const TOP_BAR_Y = 24;
const QUEST_PANEL_Y = 100;
// 오리 발 가운데 높이. 조작 버튼은 위 버튼이 오리 머리, 아래 버튼이 오리 발쯤에 오도록 맞춘다.
const DUCK_FEET_Y = 900;
const DOWN_BUTTON_CENTER_Y = 860;
const STATUS_Y = 950;
const BOTTOM_BUTTON_Y = 1010;

export interface FlagSceneOptions {
  room: Room;
  // ENTER_ROOM 의 player1 이 나인지 확인용(혼자라 항상 나다).
  my_userid: string;
  // 청기백기는 재접속이 없어(서버 결정) 항상 false 로 온다. 씬 옵션을 모든 게임이 같게 쓰려고 받아만 둔다.
  is_rejoin: boolean;
  notice_banner: NoticeBanner;
  // 로비로 돌아갈 때 새 로비 씬을 만들기 위한 콜백.
  onExitToLobby: () => void;
}

export class FlagScene implements Scene {
  readonly view = new Container();

  private readonly options: FlagSceneOptions;
  private readonly connection: FlagConnection;
  private readonly title_text: Text;
  private readonly my_info_text: Text;
  private readonly status: Text;
  private readonly quest_panel = new FlagQuestPanel();
  private readonly duck = new FlagDuck();
  private readonly control_panel: FlagControlPanel;
  private readonly ready_button: Button;
  private readonly leave_button: Button;
  private readonly back_to_lobby_button: Button;
  private readonly game_start_banner = new GameStartBanner(CUTE_THEME);
  private readonly confetti = new Confetti();
  private readonly result_popup: GameResultPopup;
  private readonly connection_lost_popup: ConnectionLostPopup;

  private my_name = "";
  // 지금 오리가 들고 있는 깃발 상태 — 버튼을 누르면 바로 바꿔 보여준다(서버 판정을 기다리지 않는다).
  // 0(정지, 수평) = 이번 문제에서 그 깃발 버튼을 아직 안 누름.
  private blue: FlagMove = FLAG_KEEP;
  private white: FlagMove = FLAG_KEEP;
  // 이번 문제에 나온 깃발 수(say 가 "" 가 아닌 깃발, 1~2) — 이만큼 서로 다른 깃발을 누르면 한 번에 보낸다.
  private quest_flag_count = 0;
  // 이번 문제에서 누른 깃발.
  private readonly pressed_sides = new Set<FlagSide>();
  // 문제가 나와 있고 아직 판정 전인지 — 이때만 버튼 입력을 받는다.
  private answering = false;
  // '나가기'로 스스로 끊는 중인지 — 아니면 onLeave 는 예기치 않은 오류로 취급한다.
  private exit_requested = false;
  // RETURN_TO_LOBBY 와 onLeave 가 같은 상황에서 둘 다 올 수 있어, 로비 전환은 한 번만 한다.
  private returned_to_lobby = false;

  constructor(options: FlagSceneOptions) {
    this.options = options;
    this.connection = new FlagConnection(options.room);

    this.title_text = new Text({
      text: "청기 백기!",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 44,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 8, join: "round" },
        dropShadow: { color: CUTE_COLOR.orange_dark, alpha: 0.5, distance: 4, angle: Math.PI / 2, blur: 0 },
      },
    });
    this.title_text.anchor.set(0.5, 0);

    this.my_info_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.brown,
        fontSize: 20,
        fontFamily: CUTE_FONT_FAMILY,
        align: "right",
        stroke: { color: 0xffffff, width: 5, join: "round" },
      },
    });
    this.my_info_text.anchor.set(1, 0);

    this.status = new Text({
      text: "입장 중...",
      style: {
        fill: CUTE_COLOR.brown,
        fontSize: 22,
        fontFamily: CUTE_FONT_FAMILY,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 640,
        stroke: { color: 0xffffff, width: 5, join: "round" },
      },
    });
    this.status.anchor.set(0.5, 0);

    this.control_panel = new FlagControlPanel({ onPress: (side, move) => this.OnPressFlag(side, move) });

    this.ready_button = new Button({
      label: "게임 시작",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.OnClickReady(),
    });
    this.ready_button.SetEnabled(false);

    this.leave_button = new Button({
      label: "나가기",
      width: 130,
      height: 52,
      theme: CUTE_THEME,
      onClick: () => this.OnClickLeave(),
    });

    this.back_to_lobby_button = new Button({
      label: "로비로 돌아가기",
      width: 440,
      height: 88,
      theme: CUTE_THEME,
      onClick: () => this.GoToLobbyOnce(),
    });
    this.back_to_lobby_button.visible = false;

    this.result_popup = new GameResultPopup({
      onReplay: () => this.OnClickReplay(),
      onExit: () => this.OnClickExit(),
      theme: CUTE_THEME,
      // 오리가 보이도록 작게 만들어 오리 발 아래에 띄우고, 뒤 게임 화면은 옅은 검정으로 덮는다.
      layout: { panel_width: 520, panel_height: 290, panel_y: 960, button_height: 56, dim_alpha: RESULT_SCREEN_DIM_ALPHA },
    });

    this.connection_lost_popup = new ConnectionLostPopup({
      button_label: "로비로 접속",
      onConfirm: () => this.GoToLobbyOnce(),
      theme: CUTE_THEME,
    });

    this.view.addChild(
      CreateCuteBackground(),
      this.title_text,
      this.my_info_text,
      this.quest_panel,
      this.control_panel,
      this.status,
      this.ready_button,
      this.back_to_lobby_button,
      this.result_popup,
      // 결과 팝업의 덮개보다 위에 둬서 오리가 어두워지지 않게 한다(팝업 패널과는 겹치지 않는다).
      this.duck,
      this.leave_button,
      this.confetti,
      this.game_start_banner,
      this.connection_lost_popup
    );

    this.connection.Listen({
      onEnterRoom: (envelope) => this.HandleEnterRoom(envelope.payload),
      onGameStart: () => this.HandleGameStart(),
      onOneStart: (envelope) => this.HandleOneStart(envelope.payload),
      onQuestShow: (envelope) => this.HandleQuestShow(envelope.payload),
      onOneResult: (envelope) => this.HandleOneResult(envelope.payload),
      onGameResult: (envelope) => this.HandleGameResult(envelope.payload),
      onReturnToLobby: () => this.GoToLobbyOnce(),
      onNotice: (envelope) => this.options.notice_banner.Show(envelope.payload.message),
      onLeave: (code) => this.HandleLeave(code),
    });

    this.connection.SendEnterRoom();
  }

  public Resize(width: number, _height: number): void {
    const center_x = width / 2;
    this.leave_button.position.set(24, TOP_BAR_Y);
    this.title_text.position.set(center_x, TOP_BAR_Y - 4);
    this.my_info_text.position.set(width - 24, TOP_BAR_Y + 2);
    this.quest_panel.position.set(center_x - FLAG_QUEST_PANEL_WIDTH / 2, QUEST_PANEL_Y);
    // 패널 기준점은 왼쪽 위 — 아래 버튼 가운데가 DOWN_BUTTON_CENTER_Y 에 오도록 올린다.
    this.control_panel.position.set(0, DOWN_BUTTON_CENTER_Y - FLAG_DOWN_BUTTON_CENTER_Y);
    this.duck.position.set(center_x, DUCK_FEET_Y);
    this.status.position.set(center_x, STATUS_Y);
    this.ready_button.position.set(center_x - this.ready_button.width / 2, BOTTOM_BUTTON_Y);
    this.back_to_lobby_button.position.set(center_x - this.back_to_lobby_button.width / 2, BOTTOM_BUTTON_Y);
  }

  public Destroy(): void {
    this.connection.Dispose();
    this.view.destroy({ children: true });
  }

  private HandleEnterRoom(payload: FlagEnterRoomPayload): void {
    const me = payload.player1;
    this.my_name = me.name || me.userid;
    this.UpdateMyInfo(me.win_per);
    this.status.text = "준비가 되면 '게임 시작'을 눌러 주세요.\n문제가 나오면 5초 안에 깃발 버튼을 누르세요!";
    this.ready_button.SetEnabled(true);
  }

  private OnClickReady(): void {
    this.connection.SendReady({ ready: "Y" });
    this.ready_button.SetEnabled(false);
    this.status.text = "곧 시작합니다...";
  }

  // 첫 시작과 재게임 모두 여기로 온다(재게임은 READY 없이 바로 GAME_START).
  private HandleGameStart(): void {
    this.confetti.Stop();
    this.result_popup.Hide();
    this.ready_button.visible = false;
    this.back_to_lobby_button.visible = false;
    this.leave_button.visible = true;
    this.status.text = "";
    this.answering = false;
    this.control_panel.SetEnabled(false);
    this.ResetFlags();
    this.quest_panel.SetProgress(0, 0);
    this.quest_panel.SetScore(0);
    this.quest_panel.ShowMessage("준비~");
    // 첫 ONE_START 가 오면 치운다(서버는 GAME_START 2초 뒤에 보낸다).
    this.game_start_banner.Show();
  }

  // 한 문제 시작 — 깃발을 정지(수평)로 돌리고 "준비~"를 보여준다. 1초 뒤 QUEST_SHOW 로 문제가 온다.
  private HandleOneStart(payload: FlagOneStartPayload): void {
    this.game_start_banner.Hide();
    this.answering = false;
    this.control_panel.SetEnabled(false);
    this.ResetFlags();
    this.quest_panel.SetProgress(payload.no, payload.total);
    this.quest_panel.ShowMessage("준비~");
  }

  private HandleQuestShow(payload: FlagQuestShowPayload): void {
    this.game_start_banner.Hide();
    this.quest_panel.ShowQuest(payload.say, payload.time);
    this.quest_flag_count = (payload.say.b !== "" ? 1 : 0) + (payload.say.w !== "" ? 1 : 0);
    this.pressed_sides.clear();
    this.answering = true;
    this.control_panel.SetEnabled(true);
  }

  // 오리는 누른 대로 바로 깃발을 바꾼다(서버 판정을 기다리지 않는다).
  // 서버는 처음 온 답 하나로 즉시 판정하므로, 문제에 나온 깃발 수만큼 서로 다른 깃발을 누를 때까지 모았다가 한 번에 보낸다
  // (같은 깃발을 다시 누르면 나중 값). 보낸 뒤에는 더 받지 않는다.
  private OnPressFlag(side: FlagSide, move: FlagMove): void {
    if (!this.answering) return;
    if (side === "b") this.blue = move;
    else this.white = move;
    this.duck.SetFlags(this.blue, this.white);
    this.pressed_sides.add(side);
    if (this.pressed_sides.size < this.quest_flag_count) return;

    // 누르지 않은 깃발은 키를 뺀다(0 은 정지 버튼).
    const quest: FlagAnswerPayload["quest"] = {};
    if (this.pressed_sides.has("b")) quest.b = this.blue;
    if (this.pressed_sides.has("w")) quest.w = this.white;
    this.connection.SendAnswer({ quest });
    this.answering = false;
    this.control_panel.SetEnabled(false);
  }

  // 판정 — 서버가 쓴 최종 답으로 오리 깃발을 맞추고 정답/오답을 보여준다. 다음 문제는 ONE_START 가 알린다.
  private HandleOneResult(payload: FlagOneResultPayload): void {
    this.answering = false;
    this.control_panel.SetEnabled(false);
    // answer 는 서버가 판정에 쓴 답이다 — null(안 누름)도 0(정지 버튼)과 같이 수평으로 보여준다.
    this.blue = payload.answer.b ?? FLAG_KEEP;
    this.white = payload.answer.w ?? FLAG_KEEP;
    this.duck.SetFlags(this.blue, this.white);

    const correct = payload.quest === "Y";
    this.duck.ShowResult(correct);
    this.quest_panel.ShowJudge(correct);
    this.quest_panel.SetScore(payload.score);
  }

  private HandleGameResult(payload: FlagGameResultPayload): void {
    this.answering = false;
    this.control_panel.SetEnabled(false);
    this.leave_button.visible = false;
    this.UpdateMyInfo(payload.win_per);
    this.quest_panel.SetScore(payload.score);
    this.quest_panel.ShowMessage(`${payload.score}점!`, CUTE_COLOR.red);
    // 마지막 문제의 "정답!/땡!" 문구를 거두고, 맞춘 게 있으면 양쪽 깃발을 들어 축하한다.
    this.ResetFlags();
    if (payload.correct_count > 0) {
      this.duck.SetFlags(FLAG_UP, FLAG_UP);
      this.confetti.Play();
    }
    // 작은 결과 팝업은 본문이 두 줄까지만 버튼에 가리지 않는다.
    this.result_popup.Show(`5문제 중 ${payload.correct_count}개 정답 · ${payload.score}점\n정답률 ${payload.win_per}%`);
  }

  private OnClickReplay(): void {
    this.connection.SendReplay({ replay: "Y" });
    this.result_popup.Hide();
    this.status.text = "다시 시작하는 중...";
  }

  private OnClickExit(): void {
    this.exit_requested = true;
    this.connection.SendReplay({ replay: "N" });
    this.status.text = "나가는 중...";
  }

  // 게임 전/중 나가기 — 방 연결을 끊고 바로 로비로 간다. 게임 중이었다면 서버가 현재 점수로 저장한다.
  private OnClickLeave(): void {
    this.exit_requested = true;
    this.connection.Leave();
    this.GoToLobbyOnce();
  }

  // RETURN_TO_LOBBY 로 이미 로비로 옮겨갔다면 아무것도 하지 않는다.
  // 내가 나가기로 스스로 끊은 것이 아니면, 무슨 일이 있었는지 보여준 뒤 직접 로비로 돌아갈 수 있게 한다.
  private HandleLeave(code?: number): void {
    if (this.returned_to_lobby) return;
    if (this.exit_requested) {
      this.GoToLobbyOnce();
      return;
    }

    this.answering = false;
    this.control_panel.SetEnabled(false);
    this.game_start_banner.Hide();
    this.result_popup.Hide();
    this.ready_button.visible = false;
    this.leave_button.visible = false;
    this.back_to_lobby_button.visible = true;
    this.status.text = `게임 채널 연결이 끊어졌습니다 (code=${code ?? "-"}).`;
    this.connection_lost_popup.Show(
      `게임 서버와의 연결이 끊어졌습니다. (code=${code ?? "-"})
서버가 꺼졌거나 네트워크가 불안정할 수 있습니다.
로비로 다시 접속해 주세요.`
    );
  }

  // RETURN_TO_LOBBY, onLeave(나가기 요청 후), 버튼 중 무엇이 먼저 오든 한 번만 전환한다.
  private GoToLobbyOnce(): void {
    if (this.returned_to_lobby) return;
    this.returned_to_lobby = true;
    this.options.onExitToLobby();
  }

  private ResetFlags(): void {
    this.blue = FLAG_KEEP;
    this.white = FLAG_KEEP;
    this.duck.Reset();
  }

  private UpdateMyInfo(win_per: number): void {
    this.my_info_text.text = `${this.my_name}\n정답률 ${win_per}%`;
  }
}
