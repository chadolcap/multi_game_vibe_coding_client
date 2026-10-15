# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Colyseus 멀티플레이어 서버에 붙는 **PixiJS + TypeScript 클라이언트**. 로비에서 게임을 골라 매칭 후 게임 채널로 입장한다.
서버는 이미 구현·실행 중이며, 이 저장소는 통신 규약에 맞춰 **클라이언트만** 개발한다.

| 진입점 | 파일 | 설명 |
| --- | --- | --- |
| 게임 클라이언트 | `index.html` + `src/main.ts` | 로비 + 게임 4종 (Pixi) |
| 관리자 페이지 | `admin.html` + `src/admin.ts` | Watcher 채널, 순수 DOM (Pixi 미사용) |

| 게임 | GameId | 폴더 |
| --- | --- | --- |
| 가위바위보 | `rps` | `src/games/rps/` |
| 오델로 | `othello` | `src/games/othello/` |
| 점핑 | `stepping` | `src/games/stepping/` |
| 에어하키 | `airhockey` | `src/games/airhockey/` |

## 명령어

```bash
npm run dev                         # Vite 개발 서버 (http://localhost:5173, /admin.html = 관리자)
npm run build                       # tsc 타입체크 후 vite build
npm run preview                     # 빌드 결과 미리보기
npx tsc --noEmit -p tsconfig.json   # 타입체크 (수정 후 항상 실행)
```

테스트/린트 도구는 없다. 검증 = `tsc --noEmit` + 브라우저 확인(2탭으로 두 플레이어 시뮬레이션).

## 통신 규약 문서 (가장 중요)

```
d:\work\study\multi_game_vibe_coding\멀티게임_바이브.xlsx
```

| 시트 | 내용 |
| --- | --- |
| `lobby` | 로비 채널 |
| `rps` / `othello` / `stepping` / `airhockey` | 각 게임 채널 |
| `관리자` | Watcher 채널 (`admin.html`) |

- **빨간 글씨** = 서버 개발자 확인/변경, **파란 글씨** = 클라이언트(이 저장소) 확인/변경.
- 서버 개발자와 실시간으로 갱신되므로 서버 소스보다 최신일 수 있다.
- 문서와 실제가 다르면 **실제 서버 응답(콘솔 로그)** 을 따르고, 문서에 파란 글씨로 비고를 남긴다.
- 문서와 다르게 동작하는 부분은 각 `types.ts`의 인터페이스 주석에 근거와 함께 적혀 있다 → 프로토콜 작업 전에 먼저 읽는다.

## 아키텍처

### 계층 구조

| 계층 | 위치 | 역할 |
| --- | --- | --- |
| Connection | `network/*Connection.ts`, `games/*/*Connection.ts` | Colyseus Room 래핑. 수신 로그 + 타입 있는 콜백만 제공 |
| Scene | `scenes/*Scene.ts`, `games/*/*Scene.ts` | 씬 1개 = Connection 1개. 서버 이벤트로 UI 상태 갱신 |
| UI | `ui/*.ts`, 게임 전용 UI | 순수 Pixi Container. 서버/네트워크를 모른다 |

### 폴더 구성

| 경로 | 내용 |
| --- | --- |
| `src/common/types.ts` | `Envelope`, 로비/관리자 메시지, 방 공통 메시지(`ENTER_ROOM`/`READY`/`GAME_RESULT` 등), `GameId` |
| `src/common/channelNames.ts` | `ParseGameIdFromRoomName()` 등 채널 이름 규칙 |
| `src/network/` | `LobbyConnection`, `WatcherConnection` |
| `src/scenes/` | `SceneManager`, `LobbyScene` |
| `src/ui/` | 공용 컴포넌트 — `Button`, `InfoPopup`, `GameResultPopup`, `GameStartBanner`, `RoundResultBanner`, `ConnectionLostPopup`, `NoticeBanner`, `LoadingOverlay`, `PlayerPanel`, `DuckMascot`(결과 오리), `Confetti`(색종이), `CuteTheme`/`UiTheme`(테마) |
| `src/games/rps/` | `RpsScene`, `RpsConnection`, `RpsChoicePanel`, `types.ts` |
| `src/games/othello/` | `OthelloScene`, `OthelloConnection`, `OthelloBoard`(8x8), `OthelloColorPanel`, `types.ts` |
| `src/games/stepping/` | `SteppingScene`, `SteppingConnection`, `SteppingMap`(맵 생성), `SteppingView`(한 유저 플레이 화면), `types.ts` |
| `src/games/airhockey/` | `AirhockeyScene`, `AirhockeyConnection`, `AirhockeyTable`(테이블 그리기 + 레버 드래그), `types.ts` |

### 코드 규칙

- **게임 전용 파일**은 `src/games/<게임명>/`에 두고, 클래스명에 게임 접두사(`Rps`, `Othello`, `Stepping`, `Airhockey`)를 붙인다.
- **게임 전용 메시지**는 `games/<게임명>/types.ts`의 `<게임>MessageType`에 둔다. 방 공통 메시지는 `common/types.ts`를 재사용한다.
- **메시지 형식**: S→C는 항상 `Envelope<P> = {type, payload, ts}`이다. C→S는 envelope 없이 `room.send(type, payload)`로 보낸다.
- **로그는 Connection에서만 남긴다.**
  - 받은 메시지는 모두 `LogReceived()`가 `[Lobby]`/`[Game]`/`[Admin]` 태그로 남긴다. wildcard(`"*"`) 핸들러가 있어 새 타입도 로그된다.
  - 씬에는 로그를 추가하지 않는다.
  - 예외: 에어하키 `PUCK_MOVE`/`LEVER_MOVE`는 너무 자주 와서 판마다 첫 `PUCK_MOVE`만 로그한다.
- **씬 파괴**: `Destroy()`가 `connection.Dispose()`로 콜백만 끊고, 연결은 닫지 않는다. 그 뒤 도착한 메시지는 로그만 남는다.
- **좌표**: 디자인 해상도 720×1280(`config.ts`)으로 고정한다. `FitCanvasToWindow()`가 CSS로만 배율을 맞추므로 좌표 계산은 항상 720×1280 기준이다.
- **타이머**: `setTimeout` 연출(배너 등)은 다음 서버 메시지가 오면 취소된다. 클라이언트 타이머를 진행 판단 근거로 쓰지 않는다.

### 씬 전환

- `SceneManager`는 씬을 한 번에 1개만 유지한다(`ChangeScene()`이 이전 씬을 `Destroy()`).
- `LoadingOverlay`, `NoticeBanner`처럼 항상 맨 위에 있어야 하는 것은 `overlays`로 등록한다.
- 로비↔게임 전환은 `main.ts`의 두 함수만 한다.
  - `GoToLobby()`: 새 `LobbyScene`을 띄우고, 이 씬이 로비 소켓에 자동 접속한다.
  - `HandleGameRoomReady()`: `GameHandoff.game`으로 게임 씬을 고른다. 씬 옵션은 모든 게임이 같다.

### 로비 → 게임 채널 (매치메이킹)

| 단계 | 동작 |
| --- | --- |
| 1 | `Client.join()`으로 로비 접속. 이 `Client`를 게임 채널 접속에도 재사용한다 |
| 2 | `MATCH_FOUND` 수신 → `seat_reservation`(`publicAddress` = 게임 채널 주소·포트) |
| 3 | `consumeSeatReservation()`으로 게임 채널에 **새 연결**을 연다 (10초 안에 하지 않으면 예약 만료) |
| 4 | 서버가 로비 연결을 `CONSENTED(4000)`로 스스로 끊는다 → 정상 흐름으로 처리 |

- **게임 종류 결정**: `room_name` 접두사로 정한다(`othello_1` → `othello`, `ParseGameIdFromRoomName()`).
- **게임 선택 전달**: `GameSelect`가 선택된 `GameId`를 들고 있고, `JOIN_MATCH`와 `PLAY_INFO`에 `game` 필드로 함께 보낸다.
- **미완성 게임**: 목록에서 빼지 않고 `GameSelect` 옵션에 `enabled: false`로 둔다.
- **재접속(`REJOIN_GAME`)**:
  - `ENTER_LOBBY` 응답 직후 서버가 `reconnection_token`을 보내면 `ConsumeRejoinToken()`이 `client.reconnect()`로 **같은 세션**에 복귀한다.
  - 재접속에 실패하면 `IsConnected()`로 로비 연결을 확인하고, 끊겨 있으면 로비부터 다시 접속한다.

### 연결 끊김 처리

끊김은 `ConnectionLostPopup`(모달, 버튼 1개)으로 알린다.

| 채널 | 정상 종료로 보는 경우 | 그 외 |
| --- | --- | --- |
| 로비 | `CONSENTED(4000)` (매칭/재접속 직후 서버가 끊음) | 팝업 → `로비로 접속` 버튼으로 재접속 |
| 게임 | 내가 나가기(`exit_requested`) 또는 `RETURN_TO_LOBBY` 수신(`returned_to_lobby`) | **종료 코드와 관계없이** 팝업 → `GoToLobbyOnce()` |

- 게임 채널은 서버가 꺼질 때도 4000으로 끊길 수 있으므로, 종료 코드로는 정상 종료를 판단하지 않는다.
- 로비의 별명 입력/게임 선택은 HTML 오버레이라서 팝업을 띄우기 전에 숨긴다(`LobbyScene.ShowConnectionLost()`).

### 네이티브 입력 (HTML 오버레이)

- Pixi에는 텍스트 입력/드롭다운이 없다. 그래서 `NicknamePopup`(input)과 `GameSelect`(select)는 투명한 HTML 요소를 `#app` 위에 겹쳐 놓는다.
- 캔버스 배율에 맞춰 위치·크기·폰트를 동기화한다(`Reposition()`/`RepositionInput()`). `resize` 때도 다시 맞춘다.
- 새 입력 UI가 필요하면 이 둘을 참고한다.

## 게임 흐름

### 공통 (방)

`ENTER_ROOM` → `READY`(양쪽) → `GAME_START` → *게임별 진행* → `GAME_RESULT` → `GAME_RESULT{replay}`(C→S)

| 재게임 선택 | 결과 |
| --- | --- |
| 양쪽 재시작 | 같은 방에서 다시 시작 |
| 한쪽만 재시작 | 재시작한 쪽은 새 상대를 기다린다 → `OPPONENT_JOINED` 수신 시 `ENTER_ROOM` 재전송 |
| 나가기 / 무응답 | `RETURN_TO_LOBBY` 수신 → 로비로 자동 이동 |

**`GAME_RESULT` payload** = `{winner, loser, draw?}`

| 항목 | 설명 |
| --- | --- |
| 나/상대 구분 | `winner.userid`를 내 `userid`와 비교한다 |
| `win_per` | `PlayerPanel.UpdateWinPer()`로 사용자 정보 패널에 반영한다 |
| `draw:"Y"` | 무승부다. `winner`/`loser`는 그냥 두 참가자이고, 오리(`DuckMascot`)가 두 별명과 "무승부"를 든다 |
| `draw` 없음 / `"N"` | 승패가 있다 |

| 게임 | `win_count` 의미 | 추가 필드 |
| --- | --- | --- |
| 가위바위보 | 승리 횟수 | — |
| 오델로 | 최종 돌 개수 (같으면 `draw:"Y"`) | — |
| 점핑 | 이동한 칸 수 | `score` = 남은 라이프×10 + 칸 수×5, `life` |
| 에어하키 | 넣은 골 수 | `score` = 골 수×5 |

### 게임별 진행

| 게임 | 진행 메시지 |
| --- | --- |
| 가위바위보 | `ONE_START` → `ONE_REMAIN_TIME`(1초마다, 0이면 자동 마감) → `SELECT_GAME`(C→S) → `ONE_RESULT`(5초 팝업) → 반복 |
| 오델로 | `DOLL_SELECT_REMAIN_TIME` → `DOLL_SELECT` → 5초 뒤 `TURN_START{turn, can}` → `TURN_REMAIN_TIME` → `SELECT_GAME`(C→S `{select:{x,y}}` / S→C `{select, change}`) → 2초 뒤 다음 `TURN_START` |
| 점핑 | `MAP_SELECT{map}` → 2초 뒤 `GAME_START` → `GAME_REMAIN_TIME`(60초) 동안 양쪽이 동시에 `MOVE_INFO` |
| 에어하키 | 3초 뒤 `ONE_START` → `PUCK_MOVE`/`LEVER_MOVE` 실시간 → 골이면 `ONE_RESULT` → 3초 뒤 다음 `ONE_START` (3골 먼저 넣으면 승리) |

**재접속 시 상태 복원** — 재접속한 당사자에게만 `GAME_STATUS`가 온다.

| 게임 | `GAME_STATUS` |
| --- | --- |
| 오델로 | `{select, status0, status1, turn, can}` — 돌 색·보드 복원. `turn`이 있으면 `TURN_START`처럼 처리 |
| 점핑 | `{map, count?, player1, player2}` — 각 `{userid, count, life, location}` |
| 에어하키 | `{puck, LEVER0, LEVER1, win_count0?, win_count1?}` — 0/1 = player1/player2 |

### 가위바위보

- 선택 버튼은 반드시 `ONE_START`를 받은 뒤에만 활성화한다. `GAME_START` 때는 5초 배너만 보여준다.

### 오델로

- 돌 색: 흰색=0, 검정=1. 검정이 먼저 둔다. 한쪽이 색을 고르면 상대는 자동으로 반대색이다.
- 합법수/뒤집기는 서버가 판정한다. 클라이언트는 받은 좌표(0~7)만 그린다. `can` = 놓을 수 있는 자리.
- PASS 메시지는 없다. 같은 유저의 `TURN_START`가 연속으로 오면 상대가 패스한 것이다.

### 점핑

- 메시지 이름은 `MAP_SELECT`다(시트의 `MAP_SEELCT`는 오타).
- 서버는 맵 번호(1~3)만 준다. 블록 배치는 `SteppingMap`이 번호별 고정 시드로 만들어 양쪽 화면이 같다.
- 착지 판정은 클라이언트(`SteppingView`)가 한다.
  - `MOVE_INFO`(C→S) = `{count, location, save}`. `count`는 도착하려던 칸 번호이고, 서버는 "직전 성공 칸 + 1"만 받는다.
- 서버는 `MOVE_INFO`에 `userid`, `life`를 붙여 양쪽 모두에게 중계한다. 상대 화면(왼쪽)은 이 값대로 뛰는 모습을 재현한다.
- 라이프는 3이다. 라이프 0에서 또 추락하거나 시간이 끝나면 `GAME_RESULT`가 온다.

### 에어하키

| 항목 | 내용 |
| --- | --- |
| 역할 분담 | 서버가 퍽 물리를 계산한다(`PUCK_MOVE{loc}`, 30Hz). 클라이언트는 내 레버 좌표만 `LEVER_MOVE{loc}`로 보내고, 상대 레버는 `LEVER_MOVE{user, loc}`로 받는다 |
| 좌표계 | 원점 = 테이블 정중앙, **y는 위쪽이 +**. 항상 내 기준(내 골대가 아래)이며 서버가 뒤집어 보내므로 클라이언트는 뒤집지 않는다 |
| 크기 상수 | 테이블/퍽/레버 크기(`types.ts`)는 서버 `airhockeyConstants.ts`와 **반드시 같아야** 한다(충돌 판정 기준) |
| 판 시작 레버 | `ONE_START`를 받으면 퍽 위/아래 `ROUND_START_OFFSET`(300) 자리를 첫 `LEVER_MOVE`로 보낸다. 서버는 그 판의 첫 `LEVER_MOVE` 좌표에 레버를 바로 놓는다 |
| 퍽 정체 | 퍽이 오래 제자리면 서버가 그 판을 다시 시작한다(`ONE_START` 재수신). 계속 진행되지 않으면 `GAME_RESULT{draw:"Y"}`로 끝난다 |

## 관리자(Watcher) 페이지

- `WatcherConnection.ts`가 `"watcher"` 룸을 감싼다. 채널은 1개이고, 포트는 `config.ts`의 `NETWORK_CONFIG.watcher_port`다. 화면은 `src/admin.ts`가 DOM으로 직접 그린다.
- 계정 정보는 **서버 `.env`에서만** 관리한다. 클라이언트 코드/문서에 절대 하드코딩하지 않는다.

| 메시지 | 설명 |
| --- | --- |
| `ADMIN_LOGIN{id, password}` | 접속 직후 필수. 로그인 전 다른 메시지는 무시되고, 10초 안에 성공하지 못하면 서버가 연결을 끊는다 |
| `ADMIN_CHANNEL_COUNT` | 전체 채널 접속자 수 |
| `ADMIN_CHANNEL_USER` | 특정 채널 유저 목록 |
| `SEND_NOTICE` | 공지 전송. `time`(예약 발송)은 서버가 아직 지원하지 않는다 |

`SEND_NOTICE`는 로비/게임 채널에도 같은 type으로 브로드캐스트된다. 클라이언트는 `NoticeBanner`(화면 맨 위 빨간 바 + 흐르는 텍스트)로 한 번 보여준다.

## 서버 저장소

| 경로 | 비고 |
| --- | --- |
| `../server_ruflo` | 현재 실행 중인 서버 — 게임 4종 구현, 메시지 타입 원본(`src/game/<게임>/<게임>Types.ts`) |
| `../server` | 일부 공통 파일 주석(`config.ts`, `channelNames.ts` 등)이 가리키는 서버 원본 경로 |

- 둘 다 **참고용으로만 읽고 절대 수정하지 않는다.**
- 클라이언트 규칙이 서버와 어긋나 보이면 파일 주석에 적힌 서버 원본부터 확인한다.
