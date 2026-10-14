// 점핑 화면 한 쪽(한 유저)의 플레이 영역. 블록(디저트 모양)이 대각선 위로 이어지고, 오리 캐릭터가 블록을 건너뛴다.
// - 내 화면(is_mine): 꾹 누르고 있으면 점프 거리가 늘어나며(궤적 점 + 착지 표시), 손을 떼면 점프한다.
//   착지 판정은 여기서 하고 결과(칸 번호/칸 중심 기준 좌표/착지 여부)를 onJump 로 씬에 넘긴다(씬이 MOVE_INFO 전송).
// - 상대 화면: 서버가 중계한 상대의 MOVE_INFO 를 받아(PlayRemoteMove) 같은 위치로 실제로 뛰는 모습을 보여준다.
// 추락하면 떨어지는 연출 뒤 앞 블록(추락 전 블록)의 중앙(0,0)에서 다시 시작한다. 라이프는 3개(하트).
import { Container, FillGradient, Graphics, Rectangle, Sprite, Text, Texture, Ticker } from "pixi.js";
import { CUTE_COLOR, CUTE_FONT_FAMILY, LoadCuteTexture } from "../../ui/CuteTheme";
import duck_url from "../../assets/images/duck.png";
import { GetCenterRatio, IsInsideBlock, type SteppingBlock, type SteppingMap } from "./SteppingMap";
import type { SteppingMoveInfoPayload, SteppingPoint, SteppingSave } from "./types";

export const STEPPING_VIEW_WIDTH = 340;
export const STEPPING_VIEW_HEIGHT = 640;
export const STEPPING_MAX_LIFE = 3;

const RADIUS = 28;
// 블록 옆면 두께.
const SIDE_HEIGHT = 26;
const CHAR_HEIGHT = 74;
// 카메라 — 캐릭터가 서 있는 블록이 화면 이 높이(비율)에 오고, 다음 블록 쪽으로 조금 당겨서 보여준다.
const CAMERA_ANCHOR_Y = 0.64;
const CAMERA_LOOKAHEAD = 0.3;
const CAMERA_EASE_MS = 160;

// 누르고 있는 동안 점프 거리가 늘어나는 속도(px/ms)와 최대 거리.
const CHARGE_SPEED = 0.26;
const MAX_CHARGE_DISTANCE = 330;
// 점프 시간/높이는 거리에 비례해서 늘린다.
const JUMP_BASE_MS = 300;
const JUMP_MS_PER_PX = 0.9;
const JUMP_ARC_BASE = 46;
const JUMP_ARC_PER_PX = 0.32;
const LAND_SQUASH_MS = 140;
const FALL_MS = 520;
const FALL_DISTANCE = 300;
const RESPAWN_MS = 600;
// 블록 중심에서 이 비율 안쪽에 착지하면 PERFECT.
const PERFECT_RATIO = 0.3;
const POPUP_MS = 800;
const PREVIEW_DOT_COUNT = 7;
// 상대 점프가 이만큼 넘게 밀려 있으면(탭이 숨겨졌다 돌아온 경우 등) 앞의 것은 연출 없이 바로 반영한다.
const MAX_REMOTE_BACKLOG = 2;

// 디저트 블록 색 조합(윗면/윗띠/아랫면/장식). SteppingMap 의 STEPPING_BLOCK_STYLE_COUNT 와 개수를 맞춘다.
const BLOCK_STYLES = [
  { top: 0xff9fb8, band: 0xffd3df, base: 0xfff4e8, deco: 0xffffff }, // 딸기 케이크
  { top: 0xffd66b, band: 0xffeaa8, base: 0xfff6de, deco: 0xc9772e }, // 커스터드 푸딩
  { top: 0x8fe3c0, band: 0xcaf3e1, base: 0xfdf8ee, deco: 0x6b4226 }, // 민트 초코
  { top: 0x9fd3ff, band: 0xd6edff, base: 0xffffff, deco: 0xffffff }, // 소다 젤리
  { top: 0x9a6a48, band: 0xc79b74, base: 0xf5e4cc, deco: 0xff8fab }, // 초코 쿠키
];
const START_STYLE = { top: 0xbfe9a0, band: 0x9fd67f, base: 0xb98a5a, deco: 0xffffff };
const GOAL_STYLE = { top: 0xffd84d, band: 0xffe999, base: 0xfff6d0, deco: 0xff8a1f };

export interface SteppingViewOptions {
  is_mine: boolean;
  tag: string;
  tag_color: number;
  // 내 화면에서 점프를 마쳤을 때(손을 뗀 순간 착지 여부가 정해진다) — 씬이 MOVE_INFO 로 보낸다.
  onJump?: (move: SteppingMoveInfoPayload) => void;
}

// idle: 다음 점프 가능 / charging: 누르는 중 / busy: 점프·추락·재시작 연출 중 / done: 완주했거나 탈락
type ViewState = "idle" | "charging" | "busy" | "done";

interface Action {
  elapsed: number;
  duration: number;
  update: (t: number) => void;
  complete?: () => void;
}

interface RemoteMove {
  count: number;
  location: SteppingPoint;
  save: SteppingSave;
  life: number;
}

export class SteppingView extends Container {
  private readonly options: SteppingViewOptions;
  // 블록/캐릭터/궤적이 들어가는 월드. 카메라는 이 컨테이너 위치를 옮겨서 표현한다.
  private readonly world = new Container();
  private readonly character = new Container();
  private readonly character_sprite = new Sprite(Texture.EMPTY);
  private readonly character_shadow: Graphics;
  private readonly preview = new Graphics();
  private readonly hearts = new Graphics();
  private readonly count_text: Text;
  private readonly name_text: Text;
  private readonly message_text: Text;
  private readonly hint_text: Text;
  private block_views: Container[] = [];
  private map: SteppingMap | null = null;
  // 지금까지 성공한 칸 수 = 캐릭터가 서 있는 블록 번호.
  private count = 0;
  private life = STEPPING_MAX_LIFE;
  // 캐릭터 발 위치(월드 좌표).
  private position_x = 0;
  private position_y = 0;
  private camera_x = 0;
  private camera_y = 0;
  private state: ViewState = "idle";
  private playable = false;
  // 누르기 시작한 시각(performance.now). 프레임이 밀려도 거리가 줄지 않도록 프레임 누적이 아니라 실제 경과 시간으로 잰다
  // (Pixi Ticker 는 프레임 간격을 최대 100ms 로 잘라서, 누적하면 느린 기기에서 같은 시간을 눌러도 덜 날아간다).
  private charge_started_at = 0;
  private sprite_scale = 1;
  private actions: Action[] = [];
  private remote_queue: RemoteMove[] = [];

  constructor(options: SteppingViewOptions) {
    super();
    this.options = options;

    const shadow = new Graphics()
      .roundRect(0, 6, STEPPING_VIEW_WIDTH, STEPPING_VIEW_HEIGHT, RADIUS)
      .fill({ color: 0x000000, alpha: 0.1 });
    const sky_gradient = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0xc4e8ff },
        { offset: 1, color: 0xf0f9ff },
      ],
    });
    const sky = new Graphics().roundRect(0, 0, STEPPING_VIEW_WIDTH, STEPPING_VIEW_HEIGHT, RADIUS).fill(sky_gradient);
    const sparkles = new Graphics();
    for (let index = 0; index < 18; index++) {
      sparkles.circle((index * 97) % STEPPING_VIEW_WIDTH, 40 + ((index * 151) % (STEPPING_VIEW_HEIGHT - 60)), 3 + (index % 3));
    }
    sparkles.fill({ color: 0xffffff, alpha: 0.6 });

    // 월드는 둥근 화면 틀 밖으로 나가지 않게 잘라낸다.
    const clip_mask = new Graphics().roundRect(0, 0, STEPPING_VIEW_WIDTH, STEPPING_VIEW_HEIGHT, RADIUS).fill(0xffffff);
    const clip = new Container();
    clip.addChild(sparkles, this.world);
    clip.mask = clip_mask;

    this.world.sortableChildren = true;
    this.character_shadow = new Graphics().ellipse(0, 0, 20, 8).fill({ color: 0x000000, alpha: 0.18 });
    this.character_sprite.anchor.set(0.5, 1);
    LoadCuteTexture(duck_url).then((texture) => {
      // 불러오는 사이에 씬이 파괴됐을 수 있다.
      if (this.character_sprite.destroyed) return;
      this.character_sprite.texture = texture;
      this.character_sprite.height = CHAR_HEIGHT;
      this.character_sprite.scale.x = this.character_sprite.scale.y;
      this.sprite_scale = this.character_sprite.scale.y;
    });
    this.character.addChild(this.character_shadow, this.character_sprite);
    this.preview.zIndex = 1500;

    const border = new Graphics()
      .roundRect(0, 0, STEPPING_VIEW_WIDTH, STEPPING_VIEW_HEIGHT, RADIUS)
      .stroke({ color: options.tag_color, width: 5 });
    const tag_background = new Graphics().roundRect(STEPPING_VIEW_WIDTH / 2 - 44, -22, 88, 38, 19).fill(options.tag_color);
    const tag_text = new Text({ text: options.tag, style: { fill: 0xffffff, fontSize: 22, fontFamily: CUTE_FONT_FAMILY } });
    tag_text.anchor.set(0.5);
    tag_text.position.set(STEPPING_VIEW_WIDTH / 2, -3);

    // 이동한 칸 수 — 화면 위 가운데에 크게(참고 영상처럼).
    this.count_text = new Text({
      text: "0",
      style: {
        fill: CUTE_COLOR.pink,
        fontSize: 56,
        fontFamily: CUTE_FONT_FAMILY,
        stroke: { color: 0xffffff, width: 8, join: "round" },
      },
    });
    this.count_text.anchor.set(0.5, 0);
    this.count_text.position.set(STEPPING_VIEW_WIDTH / 2, 26);

    this.hearts.position.set(18, 30);

    this.name_text = new Text({
      text: "",
      style: { fill: CUTE_COLOR.brown, fontSize: 16, fontFamily: CUTE_FONT_FAMILY, stroke: { color: 0xffffff, width: 4, join: "round" } },
    });
    this.name_text.anchor.set(1, 0);
    this.name_text.position.set(STEPPING_VIEW_WIDTH - 16, 30);

    this.message_text = new Text({
      text: "",
      style: {
        fill: CUTE_COLOR.orange,
        fontSize: 40,
        fontFamily: CUTE_FONT_FAMILY,
        align: "center",
        stroke: { color: 0xffffff, width: 8, join: "round" },
      },
    });
    this.message_text.anchor.set(0.5);
    this.message_text.position.set(STEPPING_VIEW_WIDTH / 2, STEPPING_VIEW_HEIGHT * 0.36);

    this.hint_text = new Text({
      text: "꾹 눌렀다가 떼면 점프!",
      style: { fill: CUTE_COLOR.brown, fontSize: 20, fontFamily: CUTE_FONT_FAMILY, stroke: { color: 0xffffff, width: 5, join: "round" } },
    });
    this.hint_text.anchor.set(0.5);
    this.hint_text.position.set(STEPPING_VIEW_WIDTH / 2, STEPPING_VIEW_HEIGHT - 40);
    this.hint_text.visible = false;

    this.addChild(
      shadow,
      sky,
      clip,
      clip_mask,
      border,
      tag_background,
      tag_text,
      this.hearts,
      this.count_text,
      this.name_text,
      this.message_text,
      this.hint_text
    );

    if (options.is_mine) {
      this.eventMode = "static";
      this.cursor = "pointer";
      this.hitArea = new Rectangle(0, 0, STEPPING_VIEW_WIDTH, STEPPING_VIEW_HEIGHT);
      this.on("pointerdown", () => this.StartCharge());
      this.on("pointerup", () => this.ReleaseCharge());
      this.on("pointerupoutside", () => this.ReleaseCharge());
    }

    this.DrawHearts();
    Ticker.shared.add(this.OnTick);
  }

  // 맵을 깔고 캐릭터를 시작 블록에 세운다(라이프/칸 수 초기화). null 이면 맵 없이 빈 하늘만 보여준다.
  public SetMap(map: SteppingMap | null): void {
    for (const block_view of this.block_views) block_view.destroy({ children: true });
    this.block_views = [];
    this.world.removeChildren();
    this.actions = [];
    this.remote_queue = [];
    this.map = map;
    this.count = 0;
    this.life = STEPPING_MAX_LIFE;
    this.state = "idle";
    this.preview.clear();
    this.message_text.text = "";

    if (map) {
      for (const block of map.blocks) {
        const block_view = CreateBlockView(block, block.index === 0, block.index === map.block_count);
        this.block_views.push(block_view);
        this.world.addChild(block_view);
      }
      this.world.addChild(this.character, this.preview);
    }
    this.PlaceCharacter(0, { x: 0, y: 0 });
    this.SnapCamera();
    this.DrawHearts();
    this.UpdateHud();
  }

  public SetName(name: string): void {
    this.name_text.text = name.length > 8 ? `${name.slice(0, 8)}…` : name;
  }

  // 내 화면 조작 가능 여부(GAME_START ~ 시간 종료/GAME_RESULT). 끄면 누르던 중인 점프는 취소한다.
  public SetPlayable(enabled: boolean): void {
    this.playable = enabled;
    if (!enabled && this.state === "charging") {
      this.state = "idle";
      this.preview.clear();
      this.ResetSquash();
    }
    this.UpdateHud();
  }

  public SetLife(life: number): void {
    this.life = life;
    this.DrawHearts();
  }

  // 화면 가운데 큰 안내 문구(맵 번호, 완주, 탈락 등). 빈 문자열이면 지운다.
  public SetMessage(text: string): void {
    this.message_text.text = text;
  }

  // 재접속(GAME_STATUS) — 연출 없이 바로 그 칸/좌표/라이프 상태로 맞춘다.
  public SetPlayerState(count: number, life: number, location: SteppingPoint): void {
    if (!this.map) return;
    this.actions = [];
    this.remote_queue = [];
    this.character.alpha = 1;
    this.character.visible = true;
    this.life = life;
    this.PlaceCharacter(Math.max(0, Math.min(count, this.map.block_count)), location);
    this.state = this.count >= this.map.block_count ? "done" : "idle";
    this.SnapCamera();
    this.DrawHearts();
    this.UpdateHud();
  }

  // 서버가 중계한 상대의 점프 한 번 — 차례대로 실제로 뛰는 연출을 보여준다.
  public PlayRemoteMove(move: RemoteMove): void {
    this.remote_queue.push(move);
    if (this.state !== "busy") this.ProcessRemoteQueue();
  }

  public override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.OnTick);
    super.destroy(options);
  }

  // --- 내 화면 조작 ---

  private StartCharge(): void {
    if (!this.playable || this.state !== "idle" || !this.GetTargetBlock()) return;
    this.state = "charging";
    this.charge_started_at = performance.now();
    this.hint_text.visible = false;
  }

  // 손을 뗀 순간 — 모은 거리만큼 다음 블록 방향으로 뛴다. 착지 지점이 다음 블록 윗면 안이면 성공, 아니면 추락.
  private ReleaseCharge(): void {
    if (this.state !== "charging") return;
    const target = this.GetTargetBlock();
    const distance = this.GetChargeDistance();
    this.preview.clear();
    this.ResetSquash();
    if (!target) {
      this.state = "idle";
      return;
    }

    const landing = this.GetLandingPoint(target, distance);
    // 서버로 보내는 좌표는 정수로 맞추고, 상대 화면도 그 값으로 그리므로 내 화면도 같은 값으로 착지시킨다.
    const location = { x: Math.round(landing.x - target.x), y: Math.round(landing.y - target.y) };
    const save: SteppingSave = IsInsideBlock(target, location.x, location.y) ? "yes" : "no";
    // 라이프가 0 인데 또 떨어지면 탈락(서버도 같은 규칙으로 게임을 끝낸다). 그 전까지는 떨어질 때마다 1개씩 쓴다.
    const life_after = save === "yes" ? this.life : Math.max(0, this.life - 1);
    const eliminated = save === "no" && this.life === 0;

    this.options.onJump?.({ count: target.index, location, save });
    this.PlayJump(target, location, save, life_after, eliminated);
  }

  private GetChargeDistance(): number {
    return Math.min(MAX_CHARGE_DISTANCE, (performance.now() - this.charge_started_at) * CHARGE_SPEED);
  }

  // 지금 위치에서 다음 블록 중심을 향해 distance 만큼 간 지점.
  private GetLandingPoint(target: SteppingBlock, distance: number): SteppingPoint {
    const dx = target.x - this.position_x;
    const dy = target.y - this.position_y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: this.position_x + (dx / length) * distance, y: this.position_y + (dy / length) * distance };
  }

  private GetTargetBlock(): SteppingBlock | null {
    return this.map?.blocks[this.count + 1] ?? null;
  }

  // --- 상대 화면 ---

  private ProcessRemoteQueue(): void {
    // 너무 밀려 있으면 앞의 것들은 연출 없이 바로 반영하고 마지막 몇 개만 보여준다.
    while (this.remote_queue.length > MAX_REMOTE_BACKLOG) {
      const move = this.remote_queue.shift();
      if (move) this.ApplyMoveInstantly(move);
    }
    const move = this.remote_queue.shift();
    if (!move || !this.map) return;

    const target = this.map.blocks[move.count];
    // 칸 번호가 어긋났으면(메시지 유실/재접속 직후 등) 연출 없이 서버 값으로 맞춘다.
    if (!target || move.count !== this.count + 1 || this.state === "done") {
      this.ApplyMoveInstantly(move);
      this.ProcessRemoteQueue();
      return;
    }
    const eliminated = move.save === "no" && this.life === 0;
    this.PlayJump(target, move.location, move.save, move.life, eliminated);
  }

  private ApplyMoveInstantly(move: RemoteMove): void {
    if (!this.map) return;
    const eliminated = move.save === "no" && this.life === 0;
    if (move.save === "yes") {
      this.PlaceCharacter(Math.min(move.count, this.map.block_count), move.location);
    } else {
      this.PlaceCharacter(Math.max(0, Math.min(move.count - 1, this.map.block_count)), { x: 0, y: 0 });
    }
    this.SetLife(move.life);
    this.character.alpha = 1;
    this.character.visible = !eliminated;
    this.state = eliminated || this.count >= this.map.block_count ? "done" : "idle";
    if (eliminated) this.message_text.text = "탈락!";
    else if (this.state === "done") this.message_text.text = "완주!";
    this.UpdateHud();
  }

  // --- 점프 연출(내 화면/상대 화면 공용) ---

  private PlayJump(target: SteppingBlock, location: SteppingPoint, save: SteppingSave, life_after: number, eliminated: boolean): void {
    this.state = "busy";
    const start_x = this.position_x;
    const start_y = this.position_y;
    const end_x = target.x + location.x;
    const end_y = target.y + location.y;
    const distance = Math.hypot(end_x - start_x, end_y - start_y);
    const arc = JUMP_ARC_BASE + distance * JUMP_ARC_PER_PX;
    const direction = Math.sign(end_x - start_x) || 1;
    this.character_shadow.visible = false;

    this.AddAction(JUMP_BASE_MS + distance * JUMP_MS_PER_PX, (t) => {
      this.character.position.set(start_x + (end_x - start_x) * t, start_y + (end_y - start_y) * t - arc * 4 * t * (1 - t));
      this.character_sprite.rotation = direction * 0.25 * Math.sin(Math.PI * t);
      // 반쯤 날아가면 다음 블록 앞쪽으로 그린다(앞 블록 뒤로 숨지 않게).
      if (t >= 0.5) this.character.zIndex = StandZ(target.index);
    }, () => {
      this.character_sprite.rotation = 0;
      this.position_x = end_x;
      this.position_y = end_y;
      if (save === "yes") this.OnLanded(target, location);
      else this.OnFell(target, start_x, start_y, life_after, eliminated);
    });
  }

  private OnLanded(target: SteppingBlock, location: SteppingPoint): void {
    this.count = target.index;
    this.character_shadow.visible = true;
    this.UpdateHud();

    const perfect = GetCenterRatio(target, location.x, location.y) <= PERFECT_RATIO;
    this.ShowPopup(perfect ? "PERFECT!" : "+1", perfect ? CUTE_COLOR.orange : CUTE_COLOR.shirt_dark);

    // 착지할 때 살짝 납작해졌다 돌아온다.
    this.AddAction(LAND_SQUASH_MS, (t) => {
      const squash = Math.sin(Math.PI * t) * 0.18;
      this.character_sprite.scale.set(this.sprite_scale * (1 + squash * 0.6), this.sprite_scale * (1 - squash));
    }, () => {
      this.ResetSquash();
      if (this.map && this.count >= this.map.block_count) {
        this.state = "done";
        this.message_text.text = "완주!";
        this.UpdateHud();
        return;
      }
      this.state = "idle";
      this.ProcessRemoteQueue();
    });
  }

  // 블록 밖에 떨어졌다 — 아래로 떨어지며 사라진 뒤, 앞 블록(지금 서 있던 블록) 중앙에서 다시 나타난다.
  private OnFell(target: SteppingBlock, start_x: number, start_y: number, life_after: number, eliminated: boolean): void {
    // 노린 블록보다 멀리 넘어갔으면 그 블록 뒤로, 못 미쳤으면 그 블록 앞으로 떨어진다.
    const path_x = target.x - start_x;
    const path_y = target.y - start_y;
    const along = ((this.position_x - start_x) * path_x + (this.position_y - start_y) * path_y) / (path_x * path_x + path_y * path_y || 1);
    this.character.zIndex = along > 1 ? StandZ(target.index) - 10 : StandZ(target.index);

    this.SetLife(life_after);
    this.ShakeHearts();
    const fall_start_y = this.position_y;
    this.AddAction(FALL_MS, (t) => {
      this.character.y = fall_start_y + FALL_DISTANCE * t * t;
      this.character.alpha = 1 - t;
      this.character_sprite.rotation = t * 0.8;
    }, () => {
      this.character_sprite.rotation = 0;
      if (eliminated) {
        this.character.visible = false;
        this.state = "done";
        this.message_text.text = "탈락!";
        this.UpdateHud();
        return;
      }
      // 앞 블록 중앙(0,0)에서 깜빡이며 다시 시작한다.
      this.PlaceCharacter(this.count, { x: 0, y: 0 });
      this.AddAction(RESPAWN_MS, (t) => {
        this.character.alpha = t >= 1 ? 1 : 0.35 + 0.65 * Math.abs(Math.cos(t * Math.PI * 3));
      }, () => {
        this.character.alpha = 1;
        this.state = "idle";
        this.ProcessRemoteQueue();
      });
    });
  }

  // --- 그리기 ---

  private PlaceCharacter(count: number, location: SteppingPoint): void {
    this.count = count;
    const block = this.map?.blocks[count];
    this.position_x = (block?.x ?? 0) + location.x;
    this.position_y = (block?.y ?? 0) + location.y;
    this.character.position.set(this.position_x, this.position_y);
    this.character.zIndex = StandZ(count);
    this.character.alpha = 1;
    this.character.visible = true;
    this.character_shadow.visible = true;
    this.character_sprite.rotation = 0;
    this.ResetSquash();
  }

  private ResetSquash(): void {
    this.character_sprite.scale.set(this.sprite_scale);
  }

  private UpdateHud(): void {
    this.count_text.text = String(this.count);
    this.hint_text.visible = this.options.is_mine && this.playable && this.count === 0 && this.state === "idle";
    this.cursor = this.options.is_mine && this.playable ? "pointer" : "default";
  }

  private DrawHearts(): void {
    this.hearts.clear();
    for (let index = 0; index < STEPPING_MAX_LIFE; index++) {
      const filled = index < this.life;
      DrawHeart(this.hearts, index * 30 + 12, 10, 24);
      this.hearts.fill(filled ? CUTE_COLOR.red : { color: 0x9aa7b4, alpha: 0.45 });
    }
  }

  private ShakeHearts(): void {
    this.AddAction(400, (t) => {
      this.hearts.x = 18 + Math.sin(t * Math.PI * 8) * 6 * (1 - t);
    });
  }

  private ShowPopup(text: string, color: number): void {
    const popup = new Text({
      text,
      style: { fill: color, fontSize: 26, fontFamily: CUTE_FONT_FAMILY, stroke: { color: 0xffffff, width: 6, join: "round" } },
    });
    popup.anchor.set(0.5, 1);
    const start_y = this.position_y - CHAR_HEIGHT - 6;
    popup.position.set(this.position_x, start_y);
    popup.zIndex = 2000;
    this.world.addChild(popup);
    this.AddAction(POPUP_MS, (t) => {
      popup.y = start_y - 34 * t;
      popup.alpha = 1 - t * t;
    }, () => popup.destroy());
  }

  // 누르는 동안 — 궤적 점과 착지 표시를 그리고 캐릭터를 납작하게 웅크린다.
  private DrawChargePreview(): void {
    const target = this.GetTargetBlock();
    this.preview.clear();
    if (!target) return;
    const distance = this.GetChargeDistance();
    const landing = this.GetLandingPoint(target, distance);
    const arc = JUMP_ARC_BASE + distance * JUMP_ARC_PER_PX;
    for (let index = 1; index <= PREVIEW_DOT_COUNT; index++) {
      const t = index / (PREVIEW_DOT_COUNT + 1);
      const x = this.position_x + (landing.x - this.position_x) * t;
      const y = this.position_y + (landing.y - this.position_y) * t - arc * 4 * t * (1 - t) - CHAR_HEIGHT * 0.4;
      this.preview.circle(x, y, 4);
    }
    this.preview.fill({ color: CUTE_COLOR.pink, alpha: 0.85 });
    this.preview.ellipse(landing.x, landing.y, 15, 8).stroke({ color: CUTE_COLOR.red, width: 3 });

    const power = distance / MAX_CHARGE_DISTANCE;
    this.character_sprite.scale.set(this.sprite_scale * (1 + power * 0.12), this.sprite_scale * (1 - power * 0.22));
  }

  private SnapCamera(): void {
    const target = this.GetCameraTarget();
    this.camera_x = target.x;
    this.camera_y = target.y;
    this.ApplyCamera();
  }

  private GetCameraTarget(): SteppingPoint {
    const blocks = this.map?.blocks;
    if (!blocks) return { x: 0, y: 0 };
    const current = blocks[Math.min(this.count, blocks.length - 1)];
    const next = blocks[this.count + 1] ?? current;
    return {
      x: current.x + (next.x - current.x) * CAMERA_LOOKAHEAD,
      y: current.y + (next.y - current.y) * CAMERA_LOOKAHEAD,
    };
  }

  private ApplyCamera(): void {
    this.world.position.set(STEPPING_VIEW_WIDTH / 2 - this.camera_x, STEPPING_VIEW_HEIGHT * CAMERA_ANCHOR_Y - this.camera_y);
  }

  private AddAction(duration: number, update: (t: number) => void, complete?: () => void): void {
    this.actions.push({ elapsed: 0, duration, update, complete });
  }

  private readonly OnTick = (ticker: Ticker): void => {
    const delta_ms = ticker.deltaMS;

    if (this.state === "charging") this.DrawChargePreview();

    // 연출 실행 — 완료 콜백에서 새 연출이 추가될 수 있어 복사본을 돌린다.
    for (const action of [...this.actions]) {
      action.elapsed += delta_ms;
      const t = Math.min(1, action.elapsed / action.duration);
      action.update(t);
      if (t >= 1) {
        this.actions = this.actions.filter((item) => item !== action);
        action.complete?.();
      }
    }

    const target = this.GetCameraTarget();
    const ease = 1 - Math.exp(-delta_ms / CAMERA_EASE_MS);
    this.camera_x += (target.x - this.camera_x) * ease;
    this.camera_y += (target.y - this.camera_y) * ease;
    this.ApplyCamera();
  };
}

// 블록 위에 서 있을 때의 그리기 순서 — 그 블록보다 앞, 바로 아래(앞쪽) 블록보다 뒤.
function StandZ(block_index: number): number {
  return -block_index * 10 + 5;
}

// 디저트 모양 블록. 원점은 윗면 중심이다. 위쪽(멀리 있는) 블록이 아래쪽 블록 뒤에 그려지도록 zIndex 를 준다.
function CreateBlockView(block: SteppingBlock, is_start: boolean, is_goal: boolean): Container {
  const style = is_start ? START_STYLE : is_goal ? GOAL_STYLE : BLOCK_STYLES[block.style % BLOCK_STYLES.length];
  const { rx, ry } = block;
  const band_height = SIDE_HEIGHT * 0.45;
  const graphics = new Graphics();

  if (block.shape === "square") {
    graphics
      .roundRect(-rx, -ry + 8, rx * 2, ry * 2 + SIDE_HEIGHT, 12)
      .fill({ color: 0x000000, alpha: 0.12 })
      .roundRect(-rx, -ry, rx * 2, ry * 2 + SIDE_HEIGHT, 12)
      .fill(style.base)
      .roundRect(-rx, -ry, rx * 2, ry * 2 + band_height, 12)
      .fill(style.band)
      .roundRect(-rx, -ry, rx * 2, ry * 2, 12)
      .fill(style.top)
      .stroke({ color: Darken(style.top, 0.85), width: 2 });
  } else {
    graphics
      .ellipse(0, SIDE_HEIGHT + 8, rx * 1.04, ry * 1.04)
      .fill({ color: 0x000000, alpha: 0.12 })
      .rect(-rx, 0, rx * 2, SIDE_HEIGHT)
      .ellipse(0, SIDE_HEIGHT, rx, ry)
      .fill(style.base)
      .rect(-rx, 0, rx * 2, band_height)
      .ellipse(0, band_height, rx, ry)
      .fill(style.band)
      .ellipse(0, 0, rx, ry)
      .fill(style.top)
      .stroke({ color: Darken(style.top, 0.85), width: 2 });
  }

  // 윗면 광택 + 블록마다 조금씩 다른 위치의 장식(스프링클).
  graphics.ellipse(-rx * 0.38, -ry * 0.38, rx * 0.3, ry * 0.2).fill({ color: 0xffffff, alpha: 0.45 });
  if (is_goal) {
    graphics.star(0, -2, 5, ry * 0.75, ry * 0.36).fill(style.deco).stroke({ color: 0xffffff, width: 2 });
  } else {
    for (let index = 0; index < 5; index++) {
      const angle = index * 1.26 + block.index * 0.7;
      graphics.circle(Math.cos(angle) * rx * 0.55, Math.sin(angle) * ry * 0.55, 3);
    }
    graphics.fill(style.deco);
  }

  const view = new Container();
  view.addChild(graphics);
  if (is_goal) {
    // 도착 블록에는 깃발을 꽂는다.
    const flag = new Graphics()
      .rect(rx * 0.55, -ry * 0.3 - 56, 4, 56)
      .fill(CUTE_COLOR.brown)
      .poly([rx * 0.55 + 4, -ry * 0.3 - 56, rx * 0.55 + 36, -ry * 0.3 - 45, rx * 0.55 + 4, -ry * 0.3 - 34])
      .fill(CUTE_COLOR.red);
    view.addChild(flag);
  }
  view.position.set(block.x, block.y);
  view.zIndex = -block.index * 10;
  return view;
}

// 동그라미 두 개 + 삼각형으로 만든 하트(채우기는 호출한 쪽에서).
function DrawHeart(graphics: Graphics, x: number, y: number, size: number): void {
  graphics
    .circle(x - size * 0.25, y, size * 0.27)
    .circle(x + size * 0.25, y, size * 0.27)
    .poly([x - size * 0.51, y + size * 0.06, x + size * 0.51, y + size * 0.06, x, y + size * 0.62]);
}

// 색을 factor 비율만큼 어둡게 한다(블록 윗면 테두리 색).
function Darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
