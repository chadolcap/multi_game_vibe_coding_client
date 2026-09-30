# [CLAUDE.md](http://CLAUDE.md)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Colyseus 기반 가위바위보 멀티플레이어 서버(`../server`, 별도 저장소)에 붙는 PixiJS + TypeScript 클라이언트.
서버가 이미 구현/실행 중인 상태에서, 서버와의 통신 규약에 맞춰 클라이언트만 개발한다.

## 명령어

```bash
npm run dev       # Vite 개발 서버 (기본 http://localhost:5173)
npm run build     # tsc 타입체크 후 vite build
npm run preview   # 빌드 결과 미리보기
npx tsc --noEmit -p tsconfig.json   # 타입체크만 (커밋/수정 후 항상 이걸로 검증)
```

테스트/린트 도구는 별도로 설정되어 있지 않다. 코드 변경 후 정확성 검증은 `tsc --noEmit`과 실제 브라우저 동작 확인(가능하면 2탭으로 두 플레이어 시뮬레이션)으로 한다.

## 통신 규약 문서 (가장 중요, 반드시 확인)

서버와의 프로토콜은 로컬 엑셀 문서로 관리되며, **서버 개발자와 실시간으로 계속 갱신**된다:

```
d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx  (시트: "통신규약")
```

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

- 모든 서버 수신 메시지는 `network/*Connection.ts`의 `LogReceived()`를 거쳐 `[Lobby]`/`[Game]` 태그로 콘솔에 무조건 로그된다. 각 Connection은 명시적으로 등록된 타입 외에 wildcard(`"*"`) 핸들러도 등록해 두어, 서버가 새 메시지 타입을 추가해도 최소한 로그는 남는다. **씬 코드에는 로깅을 추가하지 않는다** — 이미 Connection 계층에서 처리된다.
- 화면은 디자인 해상도 720×1280(`config.ts`의 `GAME_WIDTH`/`GAME_HEIGHT`)로 고정하고, `main.ts`의 `FitCanvasToWindow()`가 CSS로만 배율을 조정한다. 좌표 계산은 항상 720×1280 기준으로 한다.



### 씬 전환 (`SceneManager`)

한 번에 씬 하나만 유지(`ChangeScene()`이 이전 씬을 `Destroy()`). `LoadingOverlay`처럼 씬이 바뀌어도 항상 최상단에 남아야 하는 것은 `overlays`로 별도 등록한다. `main.ts`의 `GoToLobby(auto_connect)` 클로저가 로비 ↔ 게임 씬 전환의 유일한 경로다.

### 로비 → 게임 채널 전환 (Colyseus 매치메이킹)

1. `Client.join(room_name)`으로 로비 룸에 접속 (`LobbyConnection.Connect()`). 이 `Client` 인스턴스는 이후 게임 채널 접속에도 재사용하므로 필드로 계속 들고 있는다.
2. `MATCH_FOUND` 수신 시 `seat_reservation`(Colyseus의 `ISeatReservation` 서브셋, `publicAddress`로 게임 채널 주소를 포함)을 받는다.
3. `Client.consumeSeatReservation(seat_reservation)`으로 **새로운** Room(새 WebSocket)을 게임 채널에 연다 — 로비 접속과 동일한 메커니즘이지만 별개의 연결이다. 10초(`SEAT_RESERVATION_SEC`) 안에 호출하지 않으면 예약이 만료된다.
4. 서버가 `MATCH_FOUND` 전송 직후 `client.leave(CloseCode.CONSENTED)`로 로비 연결을 **스스로** 끊는다. 클라이언트는 `onLeave`에서 `CloseCode.CONSENTED(4000)`를 정상 흐름으로 구분해서 처리해야 하며, 그 외 코드(예: `WITH_ERROR = 4002`)는 진짜 에러로 취급해 UI에 노출해야 한다 — 이 구분을 놓치면 "접속했는데 이전 화면에 멈춰있는" 것처럼 보이는 버그가 된다.



### 게임 룸 상태 흐름 (서버 주도, 클라이언트는 수신만)

`ENTER_ROOM` → (`READY` 양쪽 완료) → `GAME_START`(5초 배너만 보여주고 아직 선택 불가) → `ONE_START`(이때부터 가위바위보 선택 가능) → `ONE_REMAIN_TIME`(1초마다 count, 0이면 자동 마감) → `SELECT_GAME`(C→S) → `ONE_RESULT`(5초 팝업) → 반복 → `GAME_RESULT`(승수 도달 시 최종) → `GAME_RESULT{replay}`(C→S, 같은 타입 재사용) → 양쪽 재시작 Y면 같은 방에서 재시작, 한쪽만 Y면 이긴 쪽은 `WaitForNewOpponent`(새 상대 오면 `OPPONENT_JOINED` 수신 → `ENTER_ROOM` 재전송), 나간 쪽은 `RETURN_TO_LOBBY` 수신 → 로비로 자동 이동.

가위바위보 선택은 반드시 `ONE_START` 수신 후에만 활성화한다 (`GAME_START` 직후 활성화하는 것은 과거에 있었던 버그). 클라이언트 측 `setTimeout` 기반 연출(배너 등)은 항상 다음 실제 서버 메시지가 먼저 오면 취소되도록 구현되어 있다 — 클라이언트 타이머를 신뢰의 근거로 쓰지 않는다.

### 프로토콜 타입 (`src/common/types.ts`)

S→C 메시지는 항상 `Envelope<P> = {type, payload, ts}` 형태. C→S는 서버가 `payload`를 그대로 읽으므로 envelope로 감싸지 않고 `room.send(type, payload)`로 보낸다. 이 파일이 프로토콜의 단일 진실 공급원이며, 문서/실제 서버 응답과 다른 부분은 인터페이스 바로 위 주석에 근거와 함께 기록해 둔다 — 새 메시지 타입을 다룰 때는 여기부터 갱신한다.

### 텍스트 입력 (Pixi 팝업 + HTML input 오버레이)

PixiJS는 네이티브 텍스트 입력을 지원하지 않는다. `NicknamePopup`처럼 실제 키 입력이 필요한 UI는 투명한 HTML `<input>`을 `#app` 위에 절대 위치로 겹쳐 놓고, 캔버스의 CSS 배율(`RepositionInput()`)에 맞춰 위치/크기/폰트 크기를 동기화한다. 창 크기 변경(`resize`) 시 재동기화가 필요하다.

## 서버 저장소와의 관계

`server/`는 별도 디렉터리(`d:\work\study\multi_game_vibe_coding\server`)의 독립된 프로젝트이며, 이 클라이언트 저장소에서는 **참고용으로만 읽고 절대 수정하지 않는다**. `config.ts`, `channelNames.ts` 등 일부 파일 주석에 대응하는 서버 원본 경로가 적혀 있으니, 규칙이 서버 쪽과 어긋나 보이면 그 경로의 서버 소스를 먼저 확인한다.