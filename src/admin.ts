// 관리자 페이지 — admin.html 의 진입점. PixiJS 를 쓰지 않고 순수 DOM 으로 구성한다
// (게임 화면이 아니라 조회/입력 위주의 관리 도구라 캔버스가 필요 없음).
import { WatcherConnection } from "./network/WatcherConnection";
import type { AdminChannelUserEntry, GameId } from "./common/types";

const LOG_TAG = "[Admin]";

function GetElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소를 찾을 수 없습니다.`);
  return el as T;
}

const login_section = GetElement<HTMLElement>("login-section");
const main_section = GetElement<HTMLElement>("main-section");
const login_form = GetElement<HTMLFormElement>("login-form");
const id_input = GetElement<HTMLInputElement>("admin-id");
const password_input = GetElement<HTMLInputElement>("admin-password");
const login_button = GetElement<HTMLButtonElement>("login-button");
const login_status = GetElement<HTMLSpanElement>("login-status");

// 전체 채널 정보 / 채널 유저 정보 / 공지 전송이 모두 같은 game 값을 쓴다.
const game_select = GetElement<HTMLSelectElement>("game-select");

const channel_count_button =GetElement<HTMLButtonElement>("channel-count-button");
const channel_count_body = GetElement<HTMLTableSectionElement>("channel-count-body");

const channel_type_select = GetElement<HTMLSelectElement>("channel-type-select");
const channel_no_input = GetElement<HTMLInputElement>("channel-no-input");
const channel_user_button = GetElement<HTMLButtonElement>("channel-user-button");
const channel_user_total = GetElement<HTMLSpanElement>("channel-user-total");
const channel_user_body = GetElement<HTMLTableSectionElement>("channel-user-body");

const notice_date_input = GetElement<HTMLInputElement>("notice-date");
const notice_start_input = GetElement<HTMLInputElement>("notice-start-time");
const notice_end_input = GetElement<HTMLInputElement>("notice-end-time");
const notice_message_input = GetElement<HTMLTextAreaElement>("notice-message");
const notice_send_button = GetElement<HTMLButtonElement>("notice-send-button");
const notice_status = GetElement<HTMLSpanElement>("notice-status");

function GetSelectedGame(): GameId {
  return game_select.value as GameId;
}

function RenderChannelCountTable(count: Record<string, number>): void {
  channel_count_body.innerHTML = "";
  for (const [room_name, ccu] of Object.entries(count)) {
    const row = document.createElement("tr");
    const name_cell = document.createElement("td");
    name_cell.textContent = room_name;
    const count_cell = document.createElement("td");
    count_cell.textContent = String(ccu);
    row.append(name_cell, count_cell);
    channel_count_body.appendChild(row);
  }
}

function RenderChannelUserTable(users: AdminChannelUserEntry[]): void {
  channel_user_body.innerHTML = "";
  for (const entry of users) {
    const row = document.createElement("tr");
    const userid_cell = document.createElement("td");
    userid_cell.textContent = entry.userid;
    const room_cell = document.createElement("td");
    room_cell.textContent = entry.room !== undefined ? String(entry.room) : "-";
    row.append(userid_cell, room_cell);
    channel_user_body.appendChild(row);
  }
}

const connection = new WatcherConnection();

async function ConnectAndLogin(): Promise<void> {
  login_status.textContent = "접속 중...";
  login_button.disabled = true;

  try {
    await connection.Connect({
      // 수신 로그는 WatcherConnection 이 항상 남기므로, 여기서는 화면 처리만 한다.
      onLoginResult: (envelope) => {
        if (envelope.payload.result === "Y") {
          login_status.textContent = "로그인 성공";
          login_section.hidden = true;
          main_section.hidden = false;
          return;
        }
        login_status.textContent = "로그인 실패 — 아이디/비밀번호를 확인하세요.";
        // 실패하면 서버가 바로 연결을 끊으므로(onLeave), 버튼 재활성화는 거기서 처리한다.
      },
      onChannelCount: (envelope) => RenderChannelCountTable(envelope.payload.count),
      onChannelUser: (envelope) => {
        channel_user_total.textContent = `총 ${envelope.payload.total}명`;
        RenderChannelUserTable(envelope.payload.user);
      },
      onError: (envelope) => {
        console.error(`${LOG_TAG} 에러 code=${envelope.payload.code} message=${envelope.payload.message}`);
      },
      onLeave: (code) => {
        console.log(`${LOG_TAG} 연결 끊어짐 code=${code ?? "-"}`);
        login_status.textContent = `연결이 끊어졌습니다 (code=${code ?? "-"}). 다시 로그인해 주세요.`;
        login_section.hidden = false;
        main_section.hidden = true;
        login_button.disabled = false;
      },
    });

    login_status.textContent = "로그인 중...";
    connection.SendAdminLogin({ id: id_input.value, password: password_input.value });
  } catch (error) {
    console.error(`${LOG_TAG} 접속 실패 ${error instanceof Error ? error.message : String(error)}`);
    login_status.textContent = "관리자 채널에 접속할 수 없습니다.";
    login_button.disabled = false;
  }
}

login_form.addEventListener("submit", (event) => {
  // 실제 페이지 이동은 막지만, submit 이벤트 자체는 그대로 발생시켜야 브라우저가
  // "비밀번호를 저장할까요?" 를 물어보고, 다음 접속부터 자동으로 채워준다.
  event.preventDefault();
  void ConnectAndLogin();
});

channel_count_button.addEventListener("click", () => {
  const payload = { game: GetSelectedGame() };
  connection.SendChannelCountRequest(payload);
  console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "ADMIN_CHANNEL_COUNT", payload })}`);
});

channel_user_button.addEventListener("click", () => {
  // channel 은 room_name 형식("lobby_1", "rps_2", "othello_1")으로 만든다. 게임 채널은 위에서 선택한 게임의
  // 이름이 접두사가 되므로(game 과 channel 이 어긋나지 않게) 채널 종류가 "game" 이면 선택한 게임명을 쓴다.
  const game = GetSelectedGame();
  const channel_prefix = channel_type_select.value === "lobby" ? "lobby" : game;
  const payload = { game, channel: `${channel_prefix}_${Number(channel_no_input.value)}` };
  connection.SendChannelUserRequest(payload);
  console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "ADMIN_CHANNEL_USER", payload })}`);
});

function GetCheckedNoticeChannels(): string[] {
  const checkboxes = document.querySelectorAll<HTMLInputElement>(".notice-channel:checked");
  return Array.from(checkboxes).map((checkbox) => checkbox.value);
}

notice_send_button.addEventListener("click", () => {
  const channel = GetCheckedNoticeChannels();
  const message = notice_message_input.value.trim();

  if (!notice_date_input.value || !notice_start_input.value || !notice_end_input.value || channel.length === 0 || !message) {
    notice_status.textContent = "날짜/시간/채널/메시지를 모두 입력해 주세요.";
    return;
  }

  // <input type="date"> 는 "YYYY-MM-DD" 형식 — mon/day 만 뽑아 쓴다(연도는 프로토콜에 없음).
  const [, mon, day] = notice_date_input.value.split("-").map(Number);

  const payload = {
    game: GetSelectedGame(),
    time: { mon, day, start: notice_start_input.value, end: notice_end_input.value },
    channel,
    message,
  };
  connection.SendNotice(payload);

  notice_status.textContent = "전송했습니다.";
  console.log(`${LOG_TAG} 클라이언트에서 보낸 내용 ${JSON.stringify({ type: "SEND_NOTICE", payload })}`);
});
