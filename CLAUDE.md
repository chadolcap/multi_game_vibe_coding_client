# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Colyseus 기반 멀티플레이어 서버(`../server`, 별도 저장소)에 붙는 PixiJS + TypeScript 클라이언트.
로비에서 게임(가위바위보 `rps`, 오델로 `othello`)을 선택해 입장하는 구조이며, 게임별 파일은
`src/games/<게임명>/`에 분리되어 있다(`src/ui/GameSelect.ts`의 `enabled` 플래그로 로비 선택 가능 여부를 제어).
서버(`../server_ruflo`)가 이미 구현/실행 중인 상태에서, 서버와의 통신 규약에 맞춰 클라이언트만 개발한다. `admin.html`/`src/admin.ts`는 플레이어용 게임
클라이언트와는 별개로 동작하는 관리자 페이지다(아래 "관리자(Watcher) 페이지" 참고).

## 명령어

```bash
npm run dev       # Vite 개발 서버 (기본 http://localhost:5173)
npm run build     # tsc 타입체크 후 vite build
npm run preview   # 빌드 결과 미리보기
npx tsc --noEmit -p tsconfig.json   # 타입체크만 (커밋/수정 후 항상 이걸로 검증)
```

`npm run dev` 기동 후 `/`는 게임 클라이언트, `/admin.html`은 관리자 페이지다(멀티 엔트리, 별도 설정 없이 Vite 기본 동작).

테스트/린트 도구는 별도로 설정되어 있지 않다. 코드 변경 후 정확성 검증은 `tsc --noEmit`과 실제 브라우저 동작 확인(가능하면 2탭으로 두 플레이어 시뮬레이션)으로 한다.

## 통신 규약 문서 (가장 중요, 반드시 확인)

서버와의 프로토콜은 로컬 엑셀 문서로 관리되며, **서버 개발자와 실시간으로 계속 갱신**된다:

```
d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx  (시트: "통신규약", "관리자")
```

- "통신규약" 시트 = 로비/게임 채널 프로토콜. "관리자" 시트 = Watcher 채널(`admin.html`) 프로토콜 —
  `ADMIN_LOGIN`/`ADMIN_CHANNEL_COUNT`/`ADMIN_CHANNEL_USER`/`SEND_NOTICE`.
- 빨간 글씨 열 = 서버 개발자의 확인/변경 사항, 파란 글씨 열 = 클라이언트(이 저장소) 쪽 확인/변경 사항.
- 이 문서가 로컬에 읽어둔 서버 소스코드보다 최신일 수 있다 — 문서와 서버 코드가 다르면 **실제 서버 응답(콘솔 로그로 확인)** 을 우선하고, 문서에 파란 글씨로 비고를 남긴다.
- `src/common/types.ts`의 각 인터페이스 주석에 문서와 실제 동작이 달랐던 이력이 기록되어 있으니, 프로토콜 관련 작업 전에 먼저 읽을 것.



## 아키텍처



### 계층 구조: Connection → Scene → UI

```
network/*Connection.ts   Colyseus Room을 감싸는 계층. 서버 메시지 수신 로깅 + 타입 있는 이벤트 콜백만 제공.
scenes/*Scene.ts         씬 하나 = Connection 하나. 서버 이벤트를 받아 UI 상태를 갱신하는 로직.
ui/*.ts                  순수 Pixi Container 컴포넌트. 서버/네트워크를 전혀 모른다.
```

### 공통 / 게임별 파일 분리

게임마다 달라지는 Scene·Connection·전용 UI·전용 프로토콜 타입은 `src/games/<게임명>/` 폴더에 모으고, 로비·관리자·
여러 게임이 같이 쓰는 것은 기존 `common/`, `network/`, `scenes/`, `ui/`에 둔다.

```
src/games/rps/       RpsScene.ts, RpsConnection.ts, RpsChoicePanel.ts, types.ts(RpsMessageType, RpsChoice, ONE_*/SELECT_GAME payload)
src/games/othello/   OthelloScene.ts, OthelloConnection.ts, OthelloBoard.ts(8x8 보드), OthelloColorPanel.ts, types.ts(OthelloMessageType, DOLL_SELECT/TURN_START/SELECT_GAME payload)
src/common/types.ts  Envelope, 로비/관리자 메시지, 방 입장·준비·결과(ENTER_ROOM/READY/GAME_RESULT 등 방 공통 메시지), GameId
src/ui/              Button, InfoPopup, GameResultPopup, GameStartBanner, RoundResultBanner 등 문자열만 받는 범용 컴포넌트
```

- 게임 전용 파일은 클래스명에 게임 접두사(`Rps`, `Othello`)를 붙여 `main.ts`에서 import 할 때 이름이 겹치지 않게 한다.
- 새 게임을 추가할 때 `common/types.ts`의 방 공통 메시지로 충분하면 그대로 재사용하고, 그 게임에만 있는 메시지만 `games/<게임명>/types.ts`에 둔다(`MessageType`에 섞지 않는다).
- 로그 태그(`[Game]`)는 게임별 Connection 에서도 그대로 쓴다.

- 모든 서버 수신 메시지는 `network/*Connection.ts`(게임 채널은 `games/*/*Connection.ts`)의 `LogReceived()`를 거쳐 `[Lobby]`/`[Game]`/`[Admin]` 태그로 콘솔에 무조건 로그된다. 각 Connection은 명시적으로 등록된 타입 외에 wildcard(`"*"`) 핸들러도 등록해 두어, 서버가 새 메시지 타입을 추가해도 최소한 로그는 남는다. **씬 코드에는 로깅을 추가하지 않는다** — 이미 Connection 계층에서 처리된다.
- 화면은 디자인 해상도 720×1280(`config.ts`의 `GAME_WIDTH`/`GAME_HEIGHT`)로 고정하고, `main.ts`의 `FitCanvasToWindow()`가 CSS로만 배율을 조정한다. 좌표 계산은 항상 720×1280 기준으로 한다.
- 예외: `admin.html`은 이 Pixi 앱과 별개의 진입점이라 Scene 이 없다. `WatcherConnection.ts`는 같은 Connection 패턴을 따르지만, `src/admin.ts`가 Scene 대신 순수 DOM으로 직접 화면을 그린다 (아래 "관리자(Watcher) 페이지" 참고).



### 씬 전환 (`SceneManager`)

한 번에 씬 하나만 유지(`ChangeScene()`이 이전 씬을 `Destroy()`). `LoadingOverlay`(로딩 스피너)와 `NoticeBanner`(관리자 공지 배너, `SEND_NOTICE` 수신 시 표시)처럼 씬이 바뀌어도 항상 최상단에 남아야 하는 것은 `overlays`로 별도 등록한다. `main.ts`의 `GoToLobby()`(인자 없음 — 호출될 때마다 새 `LobbyScene`이 뜨자마자 스스로 로비 소켓에 자동 접속한다. "로비 접속" 버튼은 없음) 클로저가 로비 ↔ 게임 씬 전환의 유일한 경로다.

### 로비 → 게임 채널 전환 (Colyseus 매치메이킹)

1. `Client.join(room_name)`으로 로비 룸에 접속 (`LobbyConnection.Connect()`). 이 `Client` 인스턴스는 이후 게임 채널 접속에도 재사용하므로 필드로 계속 들고 있는다.
2. `MATCH_FOUND` 수신 시 `seat_reservation`(Colyseus의 `ISeatReservation` 서브셋, `publicAddress`로 게임 채널 주소를 포함)을 받는다.
3. `Client.consumeSeatReservation(seat_reservation)`으로 **새로운** Room(새 WebSocket)을 게임 채널에 연다 — 로비 접속과 동일한 메커니즘이지만 별개의 연결이다. 10초(`SEAT_RESERVATION_SEC`) 안에 호출하지 않으면 예약이 만료된다.
4. 서버가 `MATCH_FOUND` 전송 직후 `client.leave(CloseCode.CONSENTED)`로 로비 연결을 **스스로** 끊는다. 클라이언트는 `onLeave`에서 `CloseCode.CONSENTED(4000)`를 정상 흐름으로 구분해서 처리해야 하며, 그 외 코드(예: `WITH_ERROR = 4002`)는 진짜 에러로 취급해 UI에 노출해야 한다 — 이 구분을 놓치면 "접속했는데 이전 화면에 멈춰있는" 것처럼 보이는 버그가 된다.

**게임 도중 재접속(`REJOIN_GAME`)**: 새로고침 등으로 끊겼다가 다시 접속하면, 로비의 `ENTER_LOBBY` 응답 직후 서버가 `REJOIN_GAME`(끊기기 전 세션의 `reconnection_token`)을 보낸다. 이 경우 `LobbyConnection.ConsumeRejoinToken()`이 `client.reconnect()`로 **같은 세션**(새 좌석이 아님)에 복귀한다. 재접속 실패 시(예: 방이 이미 disposed) 로비 연결 자체도 서버가 끊어놨을 수 있으므로, `LobbyScene`은 `IsConnected()`로 확인 후 필요하면 로비부터 다시 접속한다.



### 게임 룸 상태 흐름 (서버 주도, 클라이언트는 수신만)

`ENTER_ROOM` → (`READY` 양쪽 완료) → `GAME_START`(5초 배너만 보여주고 아직 선택 불가) → `ONE_START`(이때부터 가위바위보 선택 가능) → `ONE_REMAIN_TIME`(1초마다 count, 0이면 자동 마감) → `SELECT_GAME`(C→S) → `ONE_RESULT`(5초 팝업) → 반복 → `GAME_RESULT`(승수 도달 시 최종) → `GAME_RESULT{replay}`(C→S, 같은 타입 재사용) → 양쪽 재시작 Y면 같은 방에서 재시작, 한쪽만 Y면 이긴 쪽은 `WaitForNewOpponent`(새 상대 오면 `OPPONENT_JOINED` 수신 → `ENTER_ROOM` 재전송), 나간 쪽은 `RETURN_TO_LOBBY` 수신 → 로비로 자동 이동.

가위바위보 선택은 반드시 `ONE_START` 수신 후에만 활성화한다 (`GAME_START` 직후 활성화하는 것은 과거에 있었던 버그). 클라이언트 측 `setTimeout` 기반 연출(배너 등)은 항상 다음 실제 서버 메시지가 먼저 오면 취소되도록 처리되어 있다 — 클라이언트 타이머를 신뢰의 근거로 쓰지 않는다.

**오델로 흐름**(`games/othello/`): `ENTER_ROOM` → `READY` → `GAME_START`(5초 배너) → `DOLL_SELECT_REMAIN_TIME`(돌 색 선택 패널 노출, 흰색=0/검정=1) → `DOLL_SELECT`(S→C 결과 `{select:{색:userid}}`, 한쪽이 고르면 상대는 자동 반대색) → 5초 뒤 `TURN_START{turn, can}`(검정 선공, `can`은 시트에 없는 서버 확장으로 놓을 수 있는 자리) → `TURN_REMAIN_TIME` → `SELECT_GAME`(C→S `{select:{x,y}}`, 좌표는 0~7) → `SELECT_GAME`(S→C `{select, change}`, change는 뒤집히는 돌 좌표) → 2초 뒤 다음 `TURN_START` 반복 → 양쪽 다 둘 곳이 없으면 `GAME_RESULT`. 별도 PASS 메시지는 없고 같은 유저의 `TURN_START`가 연속으로 오면 상대가 패스한 것이다. 오델로 `GAME_RESULT`의 `win_count`는 승리 횟수가 아니라 **최종 돌 개수**이고, 돌 개수가 같으면 `draw:"Y"`가 붙는다. 보드 규칙(합법수/뒤집기)은 서버가 판정하므로 클라이언트는 받은 좌표만 그린다. **재접속**: 게임 중 같은 방으로 재접속(`REJOIN_GAME`)한 당사자에게만 서버가 `GAME_STATUS{select, status0, status1, turn, can}`(돌 색 배정 + 흰색/검정 돌 좌표 목록 + 지금 차례 유저와 그 유저가 놓을 수 있는 자리)를 보내고, `OthelloScene.HandleGameStatus()`가 이걸로 돌 색과 보드를 통째로 복원한 뒤 `turn`이 있으면 `TURN_START`와 같은 경로로 처리해 내 차례였다면 이어서 둘 수 있게 한다. 이 메시지를 받기 전(또는 서버가 아직 구현 전)에는 보드가 실제와 다를 수 있어 안내 문구를 띄운다.

`GAME_RESULT`의 `payload`는 `player1`/`player2`가 아니라 `{winner, loser}`(각각 `{userid, win_count, win_per}`)다 — `winner.userid`를 내 `userid`와 비교해 나/상대를 바로 구분한다(더 이상 `is_player1_me` 비교가 필요 없음). `win_per`는 `RpsScene`이 `ENTER_ROOM` 때 그린 사용자 정보 패널에도 반영한다(`PlayerPanel.UpdateWinPer()`).

### 프로토콜 타입 (`src/common/types.ts`)

S→C 메시지는 항상 `Envelope<P> = {type, payload, ts}` 형태. C→S는 서버가 `payload`를 그대로 읽으므로 envelope로 감싸지 않고 `room.send(type, payload)`로 보낸다. 이 파일이 프로토콜의 단일 진실 공급원이며, 문서/실제 서버 응답과 다른 부분은 인터페이스 바로 위 주석에 근거와 함께 기록해 둔다 — 새 메시지 타입을 다룰 때는 여기부터 갱신한다.

### 네이티브 입력 (Pixi 팝업 + HTML 오버레이)

PixiJS는 네이티브 텍스트 입력/드롭다운을 지원하지 않는다. `NicknamePopup`(텍스트 입력)과 `GameSelect`(게임 선택
드롭다운)는 둘 다 같은 패턴을 쓴다: 투명한 HTML `<input>`/`<select>`를 `#app` 위에 절대 위치로 겹쳐 놓고,
캔버스의 CSS 배율(`Reposition()`/`RepositionInput()`)에 맞춰 위치/크기/폰트 크기를 동기화한다. 창 크기 변경
(`resize`) 시 재동기화가 필요하다. 이 패턴이 필요한 새 입력 UI를 추가할 때는 이 둘을 참고한다.

### 로비 게임 선택 (멀티게임 확장)

`GameSelect`(로비 UI)가 현재 선택된 게임(`GameId`: `"rps"` | `"othello"`)을 들고 있고, `JOIN_MATCH`와
`PLAY_INFO` 요청 모두 이 값을 `game` 필드로 함께 보낸다 — 서버가 어떤 게임에 대한 매칭/전적인지 구분해야 하기
때문이다. 아직 게임 로직이 없는 게임을 추가할 때는 `GameSelect`의 옵션 목록에서 `enabled: false`로 선택만
막아두고(목록에서 완전히 빼지 않음), 완성되면 이 플래그를 켠다.

매칭 성사(`MATCH_FOUND`)/재접속(`REJOIN_GAME`) 후 어느 게임 씬을 띄울지는 `room_name` 접두사(`othello_1` →
`othello`, `ParseGameIdFromRoomName()`)로 정해 `GameHandoff.game`에 담고, `main.ts`의 `HandleGameRoomReady`가
이 값으로 `RpsScene`/`OthelloScene`을 고른다. 게임 채널 포트는 서버가 `seat_reservation.publicAddress`로
알려주므로(오델로는 서버 `.env`의 `OTHELLO_PORTS`, 로컬 테스트는 6031) 클라이언트가 직접 다루지 않는다.

## 관리자(Watcher) 페이지

`admin.html` + `src/admin.ts`는 로비/게임 클라이언트(`index.html` + `src/main.ts`)와 별개의 Vite 진입점이다.
PixiJS 를 쓰지 않고 순수 DOM 으로 구성되어 있다 — 조회/입력 위주의 관리 도구라 캔버스가 필요 없다.

- `WatcherConnection.ts`가 `network/*Connection.ts`와 같은 패턴으로 `"watcher"` 룸(번호 없음, 채널 1개뿐,
  포트는 `config.ts`의 `NETWORK_CONFIG.watcher_port`)을 감싼다.
- 접속 직후 `ADMIN_LOGIN({id, password})`을 보내야 한다 — 로그인 전에는 서버가 다른 모든 관리자 메시지를
  무시하고, 10초 안에 로그인하지 않거나 실패하면 서버가 연결을 끊는다. 계정 정보는 서버 `.env`로만 관리하며
  클라이언트 코드/문서에 절대 하드코딩하지 않는다.
- 로그인 후 `ADMIN_CHANNEL_COUNT`(전체 채널 접속자 수), `ADMIN_CHANNEL_USER`(특정 채널 유저 목록),
  `SEND_NOTICE`(공지 전송)를 쓸 수 있다. `SEND_NOTICE`의 `time`(예약 발송 시간) 필드는 엑셀 문서 예시에는
  있지만 서버가 아직 안 받는다 — UI는 있지만 동작은 기대하지 말 것(서버 쪽 구현 전까지).
- `SEND_NOTICE`는 로비/게임 채널에도 같은 type 으로 재사용되어 브로드캐스트된다(옛 이름 `NOTICE`는 폐지됨).
  로비/게임 클라이언트는 `NoticeBanner` 오버레이로 화면 맨 위에 빨간 바 + 흘러가는 텍스트로 한 번만 보여준다.

## 서버 저장소와의 관계

`server/`는 별도 디렉터리(`d:\work\study\multi_game_vibe_coding\server`)의 독립된 프로젝트이며, 이 클라이언트 저장소에서는 **참고용으로만 읽고 절대 수정하지 않는다**. `config.ts`, `channelNames.ts` 등 일부 파일 주석에 대응하는 서버 원본 경로가 적혀 있으니, 규칙이 서버 쪽과 어긋나 보이면 그 경로의 서버 소스를 먼저 확인한다.