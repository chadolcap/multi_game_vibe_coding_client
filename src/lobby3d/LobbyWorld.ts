// 로비 3D 화면 — three.js 캔버스를 Pixi 캔버스 **아래에** 겹쳐 그린다. UI 는 지금처럼 Pixi 가 위에서 맡는다.
// 서버/네트워크는 모른다. 조이스틱 입력(SetMoveInput)으로 오리를 걷게 하고, 드래그(RotateCamera)·핀치(ZoomCamera)로 시점을 바꾸며,
// 건물 근처에 가면 콜백으로 알린다.
// ⚠️ GameSelect/NicknamePopup 이 "#app canvas"(첫 번째 캔버스 = Pixi)로 위치를 재므로, 3D 캔버스는 DOM 에서 Pixi 뒤에 붙이고
//    z-index 로만 아래에 깐다.
import * as THREE from "three";
import { GAME_HEIGHT, GAME_WIDTH } from "../config";
import type { GameId, LobbyUserInfo } from "../common/types";
import { BuildDuck, BuildIslandOne, ClearIslandMaterialCache, CreateNameLabel, type IslandOneModel } from "./IslandOne";
import { LOBBY_PLACES, PLAYER_START, TICKET_GATE, WALK_RADIUS, type LobbyPlace } from "./lobbyPlaces";

const SKY_COLOR = 0xbfeeff;
const PLAYER_RADIUS = 0.8;
const WALK_SPEED = 8; // 초당 이동 거리
const TURN_SPEED = 12;
const ARRIVE_DISTANCE = 0.12;
// 건물 충돌 반지름에서 이만큼 안으로 들어오면 입장 버튼을 보여준다.
const PLACE_NEAR_DISTANCE = 3;
const GATE_OPEN_DISTANCE = 5.5;
const GATE_OPEN_ANGLE = 1.45;
// 카메라는 오리 주위를 도는 구면 좌표(방위 yaw · 올려본 각 pitch · 거리)로 둔다. yaw 0 = 오리 남쪽(매표소 쪽)에서 북쪽을 본다.
const CAMERA_START_DISTANCE = Math.hypot(20, 25);
const CAMERA_START_PITCH = Math.atan2(20, 25);
const CAMERA_MIN_PITCH = 0.25;
const CAMERA_MAX_PITCH = 1.35;
const CAMERA_MIN_DISTANCE = 12;
const CAMERA_MAX_DISTANCE = 48;
const CAMERA_ROTATE_PER_PIXEL = 0.008; // 드래그 1px(720 기준)당 회전 라디안
const CAMERA_LOOK_AHEAD = 10; // 오리를 화면 아래쪽에 두어 앞쪽 섬이 더 보이게 한다
const CAMERA_FOLLOW_SPEED = 4;
// 조이스틱을 이만큼 안쪽으로만 밀면 서 있는다 (손가락 떨림 무시)
const MOVE_DEAD_ZONE = 0.12;
const MAX_DELTA_SEC = 0.05;
const MAX_FRAME_SEC = 1; // 탭을 오래 가렸다 돌아와도 한 번에 이만큼만 진행한다
const MAX_PIXEL_RATIO = 2;
// 내 위치를 서버에 알리는 간격 (서버가 0.2초마다 묶어서 나눠 준다)
const POSITION_REPORT_SEC = 0.2;
const POSITION_REPORT_MIN_DISTANCE = 0.03;
// 다른 유저 위치는 0.2초마다 오므로 조금 더 빠르게 따라잡아 뒤처지지 않게 한다. 너무 멀면 걷지 않고 옮긴다.
const REMOTE_WALK_SPEED = WALK_SPEED * 1.25;
const REMOTE_SNAP_DISTANCE = 15;
const NAME_LABEL_Y = 2.9;

// 오리 모델 + 걷는 동작. 내 오리와 다른 유저 오리가 함께 쓴다.
class DuckActor {
  public readonly group: THREE.Group;
  private readonly wings: THREE.Object3D[];
  private readonly feet: THREE.Object3D[];
  private walk_time = 0;

  constructor(group: THREE.Group) {
    this.group = group;
    this.wings = ["wing_left", "wing_right"].map((name) => group.getObjectByName(name)!);
    this.feet = ["foot_left", "foot_right"].map((name) => group.getObjectByName(name)!);
  }

  public FaceDirection(dx: number, dz: number, delta: number): void {
    const facing = Math.atan2(dx, dz);
    const rotation = this.group.rotation;
    const turn = Math.atan2(Math.sin(facing - rotation.y), Math.cos(facing - rotation.y));
    rotation.y += turn * Math.min(TURN_SPEED * delta, 1);
  }

  public Animate(is_walking: boolean, delta: number, elapsed: number): void {
    if (is_walking) this.walk_time += delta * 11;
    const swing = is_walking ? Math.sin(this.walk_time) : 0;
    this.group.rotation.z = swing * 0.11;
    this.group.position.y = is_walking ? Math.abs(swing) * 0.16 : Math.max(0, Math.sin(elapsed * 2.6) * 0.035);
    this.feet[0].position.z = 0.12 + swing * 0.3;
    this.feet[1].position.z = 0.12 - swing * 0.3;
    this.wings[0].rotation.z = 0.15 + Math.abs(swing) * 0.35;
    this.wings[1].rotation.z = -0.15 - Math.abs(swing) * 0.35;
  }
}

interface RemotePlayer {
  actor: DuckActor;
  label: THREE.Sprite;
  name: string;
  color: number;
  target_x: number;
  target_z: number;
}


export interface LobbyWorldOptions {
  // Pixi 캔버스 — 3D 캔버스 크기를 이 CSS 크기에 맞춘다.
  overlay_canvas: HTMLCanvasElement;
  // 입장할 수 있는 건물 근처에 들어오거나(건물) 벗어나면(null) 호출한다.
  onNearPlaceChanged: (place: LobbyPlace | null) => void;
  // 매표소 게이트를 처음 통과하면 한 번 호출한다.
  onGatePassed: () => void;
  // 내 오리가 움직이면 최대 POSITION_REPORT_SEC 마다 호출한다.
  onPlayerMoved: (x: number, z: number) => void;
  // 방금 끝낸 게임 — 있으면 매표소 대신 그 게임 건물 앞에서 시작한다.
  return_game?: GameId;
}

export class LobbyWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, GAME_WIDTH / GAME_HEIGHT, 1, 400);
  private readonly island: IslandOneModel;
  // 색은 서버가 LOBBY_USERS 로 알려 주면 SetPlayerColor 가 바꾼다 (그 전에는 기본 노랑)
  private player = BuildDuck();
  private player_actor: DuckActor;
  private readonly remote_players = new Map<string, RemotePlayer>();
  private readonly timer = new THREE.Clock();
  private readonly resize = () => this.SyncCanvasSize();
  private readonly options: LobbyWorldOptions;

  private frame_id = 0;
  // 조이스틱 입력 -1~1 (x 오른쪽, y 아래쪽 — 화면 기준)
  private readonly move_input = { x: 0, y: 0 };
  // 카메라가 따라가는 점 — 오리 위치를 부드럽게 쫓는다
  private readonly camera_focus = new THREE.Vector3();
  private camera_yaw = 0;
  private camera_pitch = CAMERA_START_PITCH;
  private camera_distance = CAMERA_START_DISTANCE;
  private gate_open = 0;
  private gate_passed = false;
  private near_place: LobbyPlace | null = null;
  private elapsed = 0;
  private last_report_time = 0;
  // 마지막으로 서버에 알린 위치. null 이면 다음 프레임에 지금 위치를 다시 알린다.
  private reported_position: { x: number; z: number } | null = { x: PLAYER_START.x, z: PLAYER_START.z };

  constructor(mount: HTMLElement, options: LobbyWorldOptions) {
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(GAME_WIDTH, GAME_HEIGHT, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "lobby-world-canvas";
    mount.appendChild(this.renderer.domElement);
    this.SyncCanvasSize();
    window.addEventListener("resize", this.resize);

    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 90, 240);
    this.AddLights();

    this.island = BuildIslandOne();
    this.scene.add(this.island.root);

    // 게임에서 돌아왔으면 그 게임 건물 앞에 서서 건물을 본다. 아니면 매표소 앞에서 섬 안쪽(화면 위)을 본다.
    const return_place = LOBBY_PLACES.find(
      (place) => place.action?.kind === "game" && place.action.game === options.return_game
    );
    if (return_place) {
      const front = this.GetPlaceFrontPoint(return_place);
      this.player.position.set(front.x, 0, front.z);
      this.player.rotation.y = Math.atan2(return_place.x - front.x, return_place.z - front.z);
      this.camera_yaw = this.player.rotation.y + Math.PI; // 오리 뒤에서 건물을 본다
      this.gate_passed = true;
      this.reported_position = null; // 서버는 매표소 앞으로 알고 있다
    } else {
      this.player.position.set(PLAYER_START.x, 0, PLAYER_START.z);
      this.player.rotation.y = Math.PI;
    }
    this.scene.add(this.player);
    this.player_actor = new DuckActor(this.player);

    this.camera_focus.set(this.player.position.x, 0, this.player.position.z);
    this.UpdateCamera(1);
    this.frame_id = requestAnimationFrame(() => this.Tick());
  }

  // 조이스틱 — x 오른쪽, y 아래쪽(화면 기준), 길이 0~1. 위로 밀면 카메라가 보는 쪽으로 걷는다.
  public SetMoveInput(x: number, y: number): void {
    this.move_input.x = x;
    this.move_input.y = y;
  }

  // 드래그한 거리(720x1280 기준 px)만큼 시점을 돌린다. 좌우 = 오리 주위를 돌기, 위아래 = 내려다보는 각도.
  public RotateCamera(dx: number, dy: number): void {
    this.camera_yaw -= dx * CAMERA_ROTATE_PER_PIXEL;
    this.camera_pitch = THREE.MathUtils.clamp(this.camera_pitch + dy * CAMERA_ROTATE_PER_PIXEL, CAMERA_MIN_PITCH, CAMERA_MAX_PITCH);
  }

  // scale < 1 이면 가까이, > 1 이면 멀리.
  public ZoomCamera(scale: number): void {
    this.camera_distance = THREE.MathUtils.clamp(this.camera_distance * scale, CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE);
  }

  // ENTER_LOBBY 직후 받은 목록으로 다른 유저를 통째로 맞춘다. 서버는 재접속한 나를 매표소 앞으로 알고 있으니 내 위치도 다시 알린다.
  public SetRemoteUsers(users: LobbyUserInfo[]): void {
    for (const id of [...this.remote_players.keys()]) this.RemoveRemoteUser(id);
    for (const user of users) this.UpsertRemoteUser(user);
    this.reported_position = null;
  }

  public UpsertRemoteUser(user: LobbyUserInfo): void {
    const remote = this.remote_players.get(user.id);
    if (!remote || remote.color !== user.color) {
      if (remote) this.RemoveRemoteUser(user.id);
      this.AddRemotePlayer(user);
      return;
    }
    remote.target_x = user.x;
    remote.target_z = user.z;
    if (remote.name !== user.name) {
      remote.name = user.name;
      this.ReplaceRemoteLabel(remote);
    }
  }

  public RemoveRemoteUser(id: string): void {
    const remote = this.remote_players.get(id);
    if (!remote) return;
    this.remote_players.delete(id);
    this.scene.remove(remote.actor.group);
    remote.label.material.map?.dispose();
    remote.label.material.dispose();
    // 재질은 섬과 함께 쓰는 캐시라 지우지 않는다.
    remote.actor.group.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
  }

  // 내 위치도 함께 오지만 목록에 없어 여기서 걸러진다.
  public MoveRemoteUser(id: string, x: number, z: number): void {
    const remote = this.remote_players.get(id);
    if (!remote) return;
    remote.target_x = x;
    remote.target_z = z;
  }

  // 서버가 정해 준 내 오리 색 — 다른 유저 화면에서도 이 색으로 보인다. 같은 자리에 같은 방향으로 다시 만든다.
  public SetPlayerColor(color: number): void {
    const previous = this.player;
    const next = BuildDuck(color);
    next.position.copy(previous.position);
    next.rotation.copy(previous.rotation);
    this.scene.remove(previous);
    previous.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
    this.scene.add(next);
    this.player = next;
    this.player_actor = new DuckActor(next);
  }

  private AddRemotePlayer(user: LobbyUserInfo): void {
    // 색은 서버가 정한 값 — 그 유저의 화면에서도 같은 색으로 보인다.
    const group = BuildDuck(user.color);
    group.position.set(user.x, 0, user.z);
    group.rotation.y = Math.PI;
    this.scene.add(group);
    const remote: RemotePlayer = {
      actor: new DuckActor(group),
      label: CreateNameLabel(user.name || "오리"),
      name: user.name,
      color: user.color,
      target_x: user.x,
      target_z: user.z,
    };
    remote.label.position.y = NAME_LABEL_Y;
    group.add(remote.label);
    this.remote_players.set(user.id, remote);
  }

  private ReplaceRemoteLabel(remote: RemotePlayer): void {
    const group = remote.actor.group;
    group.remove(remote.label);
    remote.label.material.map?.dispose();
    remote.label.material.dispose();
    remote.label = CreateNameLabel(remote.name || "오리");
    remote.label.position.y = NAME_LABEL_Y;
    group.add(remote.label);
  }

  public Destroy(): void {
    cancelAnimationFrame(this.frame_id);
    window.removeEventListener("resize", this.resize);
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials) {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
    });
    ClearIslandMaterialCache();
    this.renderer.dispose();
    // 게임 씬에서 GPU 자원을 쓰지 않도록 WebGL 컨텍스트까지 돌려준다.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private AddLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xfffbe8, 0xa8dca0, 2.1));
    const sun = new THREE.DirectionalLight(0xfff1cc, 2.2);
    sun.position.set(-26, 46, 26);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 5;
    sun.shadow.bias = -0.0006;
    // 둥근 면에 줄무늬 그림자(그림자 여드름)가 생겨 움직일 때 반짝이지 않게 법선 방향으로도 띄운다.
    sun.shadow.normalBias = 0.03;
    sun.shadow.camera.left = -46;
    sun.shadow.camera.right = 46;
    sun.shadow.camera.top = 46;
    sun.shadow.camera.bottom = -46;
    sun.shadow.camera.far = 130;
    this.scene.add(sun);
  }

  private SyncCanvasSize(): void {
    const style = this.renderer.domElement.style;
    style.width = this.options.overlay_canvas.style.width;
    style.height = this.options.overlay_canvas.style.height;
  }

  private GetPlaceFrontPoint(place: LobbyPlace): THREE.Vector3 {
    const distance = Math.hypot(place.x, place.z);
    if (distance === 0) {
      return new THREE.Vector3(0, 0, place.collide_radius + PLAYER_RADIUS + 0.4);
    }
    const front = place.collide_radius + PLAYER_RADIUS + 0.4;
    return new THREE.Vector3(place.x - (place.x / distance) * front, 0, place.z - (place.z / distance) * front);
  }

  private Tick(): void {
    this.frame_id = requestAnimationFrame(() => this.Tick());
    // 프레임이 끊겨도 슬로모션이 되거나 벽을 뚫지 않도록 실제 경과 시간을 작은 스텝으로 나눠 처리한다.
    let remaining = Math.min(this.timer.getDelta(), MAX_FRAME_SEC);
    while (remaining > 0) {
      const delta = Math.min(remaining, MAX_DELTA_SEC);
      remaining -= delta;
      this.elapsed += delta;
      this.UpdatePlayer(delta);
      this.UpdateRemotePlayers(delta);
      this.UpdateGate(delta);
      this.UpdateNearPlace();
      this.UpdateAmbient(delta);
      this.UpdateCamera(delta);
    }
    this.ReportPosition();
    this.renderer.render(this.scene, this.camera);
  }

  private UpdatePlayer(delta: number): void {
    const position = this.player.position;
    const input = this.move_input;
    const strength = Math.min(Math.hypot(input.x, input.y), 1);
    const is_walking = strength > MOVE_DEAD_ZONE;

    if (is_walking) {
      // 화면 기준 입력을 카메라 방위만큼 돌린다 — 화면 위 = 카메라가 보는 쪽(-sin yaw, -cos yaw)
      const sin = Math.sin(this.camera_yaw);
      const cos = Math.cos(this.camera_yaw);
      const dir_x = input.x * cos + input.y * sin;
      const dir_z = -input.x * sin + input.y * cos;
      const length = Math.hypot(dir_x, dir_z);
      const step = WALK_SPEED * strength * delta;
      position.x += (dir_x / length) * step;
      position.z += (dir_z / length) * step;
      this.ResolveCollisions();
      this.player_actor.FaceDirection(dir_x, dir_z, delta);
    }

    this.player_actor.Animate(is_walking, delta, this.elapsed);
  }

  // 받은 위치를 향해 걷는다. 다른 유저 충돌은 하지 않는다 — 좁은 게이트에서 서로 막히지 않게.
  private UpdateRemotePlayers(delta: number): void {
    for (const remote of this.remote_players.values()) {
      const position = remote.actor.group.position;
      const to_x = remote.target_x - position.x;
      const to_z = remote.target_z - position.z;
      const distance = Math.hypot(to_x, to_z);
      const is_walking = distance > ARRIVE_DISTANCE;
      if (distance > REMOTE_SNAP_DISTANCE) {
        position.x = remote.target_x;
        position.z = remote.target_z;
      } else if (is_walking) {
        const step = Math.min(REMOTE_WALK_SPEED * delta, distance);
        position.x += (to_x / distance) * step;
        position.z += (to_z / distance) * step;
        remote.actor.FaceDirection(to_x, to_z, delta);
      }
      remote.actor.Animate(is_walking, delta, this.elapsed);
    }
  }

  private ReportPosition(): void {
    if (this.elapsed - this.last_report_time < POSITION_REPORT_SEC) return;
    const { x, z } = this.player.position;
    const reported = this.reported_position;
    if (reported && Math.hypot(x - reported.x, z - reported.z) < POSITION_REPORT_MIN_DISTANCE) return;
    this.last_report_time = this.elapsed;
    this.reported_position = { x, z };
    this.options.onPlayerMoved(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
  }

  private ResolveCollisions(): void {
    const position = this.player.position;
    for (const obstacle of this.island.obstacles) {
      const dx = position.x - obstacle.x;
      const dz = position.z - obstacle.z;
      const distance = Math.hypot(dx, dz);
      const min_distance = obstacle.radius + PLAYER_RADIUS;
      if (distance < min_distance && distance > 0) {
        position.x = obstacle.x + (dx / distance) * min_distance;
        position.z = obstacle.z + (dz / distance) * min_distance;
      }
    }
    const from_center = Math.hypot(position.x, position.z);
    if (from_center > WALK_RADIUS) {
      position.x *= WALK_RADIUS / from_center;
      position.z *= WALK_RADIUS / from_center;
    }
  }

  private UpdateGate(delta: number): void {
    const position = this.player.position;
    const distance = Math.hypot(position.x - TICKET_GATE.x, position.z - TICKET_GATE.z);
    const goal = distance < GATE_OPEN_DISTANCE ? 1 : 0;
    this.gate_open += (goal - this.gate_open) * Math.min(delta * 6, 1);
    for (const arm of this.island.gate_arms) {
      arm.rotation.z = (arm.userData.side as number) * -GATE_OPEN_ANGLE * this.gate_open;
    }
    if (!this.gate_passed && position.z < TICKET_GATE.z - 1) {
      this.gate_passed = true;
      this.options.onGatePassed();
    }
  }

  private UpdateNearPlace(): void {
    const position = this.player.position;
    let nearest: LobbyPlace | null = null;
    let nearest_gap = PLACE_NEAR_DISTANCE;
    for (const place of LOBBY_PLACES) {
      if (!place.action) continue;
      const gap = Math.hypot(position.x - place.x, position.z - place.z) - place.collide_radius;
      if (gap < nearest_gap) {
        nearest = place;
        nearest_gap = gap;
      }
    }
    if (nearest !== this.near_place) {
      this.near_place = nearest;
      this.options.onNearPlaceChanged(nearest);
    }
  }

  private UpdateAmbient(delta: number): void {
    this.island.water.position.y = -1.6 + Math.sin(this.elapsed * 0.9) * 0.05;
    for (const cloud of this.island.clouds) {
      cloud.position.x += delta * 0.5;
      if (cloud.position.x > 70) cloud.position.x = -70;
    }
  }

  private UpdateCamera(delta: number): void {
    // 오리 위치만 부드럽게 따라가고, 회전·확대는 바로 반영한다(손가락을 따라 바로 돌아야 어지럽지 않다).
    const position = this.player.position;
    const follow = Math.min(CAMERA_FOLLOW_SPEED * delta, 1);
    this.camera_focus.lerp(new THREE.Vector3(position.x, 0, position.z), follow);

    const sin = Math.sin(this.camera_yaw);
    const cos = Math.cos(this.camera_yaw);
    const horizontal = this.camera_distance * Math.cos(this.camera_pitch);
    const look_ahead = CAMERA_LOOK_AHEAD * (this.camera_distance / CAMERA_START_DISTANCE);
    this.camera.position.set(
      this.camera_focus.x + sin * horizontal,
      this.camera_distance * Math.sin(this.camera_pitch),
      this.camera_focus.z + cos * horizontal
    );
    this.camera.lookAt(this.camera_focus.x - sin * look_ahead, 0, this.camera_focus.z - cos * look_ahead);
    this.camera.updateMatrixWorld();
  }
}
