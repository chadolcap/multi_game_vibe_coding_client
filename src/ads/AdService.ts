// 광고 재생 담당. 로비 '광고 보기'(보상형)와 게임 종료 → 로비 이동 사이(전면)에 쓴다.
// 실제 광고는 index.html 이 불러오는 adsbygoogle.js 의 H5 게임 광고 API(adBreak)를 쓴다.
// 게시자 ID(VITE_ADSENSE_CLIENT)가 없으면 개발용 가짜 광고(N초 대기)로 대신한다 (서버 docs/HANDOFF.md 2-1 허용).
// 광고 화면은 Pixi 씬과 상관없이 떠야 하므로(씬 전환 중에도 보임) DOM 으로 #app 위에 띄운다.

// adConfig() 에 넘기는 값 — https://developers.google.com/ad-placement/apis/adconfig
interface AdConfigOptions {
  preloadAdBreaks?: "on" | "auto";
  sound?: "on" | "off";
  onReady?: () => void;
}

// adBreak() 에 넘기는 값 — https://developers.google.com/ad-placement/apis/adbreak
interface AdBreakPlacement {
  type: "reward" | "next";
  name: string;
  beforeAd?: () => void;
  afterAd?: () => void;
  beforeReward?: (show_ad: () => void) => void;
  adDismissed?: () => void;
  adViewed?: () => void;
  adBreakDone?: (placement_info: { breakStatus?: string }) => void;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[] & { loaded?: boolean };
  }
}

// 개발용 가짜 광고 길이.
const FAKE_REWARD_AD_SEC = 5;
const FAKE_INTERSTITIAL_AD_SEC = 3;
// adBreak() 를 불렀는데 이 시간 안에 광고 시작(beforeReward/beforeAd)도, 끝(adBreakDone)도 안 오면
// 광고를 못 띄우는 상황(스크립트 차단 등)으로 보고 진행한다. 광고 재생 시간이 아니라 "시작 응답" 대기다.
const AD_START_TIMEOUT_MS = 5000;
// 보상형 광고는 미리 받아 둔(preload) 광고가 있을 때만 뜬다. 아직 없으면(breakStatus=noAdPreloaded)
// 스피너를 띄운 채 잠깐 기다렸다가 다시 요청한다 — 첫 클릭에 광고가 안 뜨던 문제 대응.
const REWARD_AD_MAX_ATTEMPTS = 4;
const REWARD_AD_RETRY_DELAY_MS = 1500;

// 가짜 광고도 실제처럼 잠깐 로딩(스피너)을 보여준 뒤 뜨게 한다.
const FAKE_AD_LOAD_MS = 700;
// 딤드는 실제 광고(Google 오버레이)보다 아래, 게임 화면/HTML 오버레이(GameSelect 등)보다 위에 둔다.
const AD_DIM_Z_INDEX = 9999;
const SPINNER_STYLE_ID = "ad-spinner-style";

const LOG_TAG = "[Ad]";

interface AdDim {
  element: HTMLDivElement;
  // 광고가 뜨면 스피너만 지우고 딤드는 광고가 끝날 때까지 둔다.
  HideSpinner: () => void;
  Remove: () => void;
}

// 광고가 뜨기 전까지 화면을 어둡게 덮고 가운데에 도는 동그라미를 보여준다.
// 딤드가 클릭을 막아, 광고를 기다리는 동안 게임/로비 버튼이 눌리지 않는다.
function ShowAdDim(): AdDim {
  if (!document.getElementById(SPINNER_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = SPINNER_STYLE_ID;
    style.textContent = "@keyframes ad-spinner-rotate { to { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }

  const element = document.createElement("div");
  element.style.cssText =
    `position:fixed;inset:0;z-index:${AD_DIM_Z_INDEX};display:flex;flex-direction:column;align-items:center;` +
    "justify-content:center;gap:16px;background:rgba(0,0,0,0.6);color:#fff;font:20px sans-serif;text-align:center;";

  const spinner = document.createElement("div");
  spinner.style.cssText =
    "width:56px;height:56px;border-radius:50%;border:6px solid rgba(255,255,255,0.25);" +
    "border-top-color:#fff;animation:ad-spinner-rotate 0.9s linear infinite;";
  element.appendChild(spinner);
  document.body.appendChild(element);

  return {
    element,
    HideSpinner: () => spinner.remove(),
    Remove: () => element.remove(),
  };
}

const ADSENSE_CLIENT: string = import.meta.env.VITE_ADSENSE_CLIENT ?? "";

// 게시자 ID 가 설정돼 있어야 실제 광고를 쓴다(ca-pub-로 시작).
function IsRealAdEnabled(): boolean {
  return ADSENSE_CLIENT.startsWith("ca-pub-");
}

// 앱 시작 때 한 번 부른다(main.ts). 광고를 미리 받아 두게 해서, 처음 '광고 보기'를 눌렀을 때 바로 뜨게 한다.
// adConfig 는 첫 adBreak 보다 먼저 불러야 한다.
export function InitAds(): void {
  if (!IsRealAdEnabled()) return;
  PushAdBreak({
    preloadAdBreaks: "on",
    sound: "on",
    onReady: () => console.log(`${LOG_TAG} 광고 API 준비 완료`),
  });
}

function PushAdBreak(placement: AdBreakPlacement | AdConfigOptions): void {
  window.adsbygoogle = window.adsbygoogle || [];
  window.adsbygoogle.push(placement);
}

// 보상형 광고 — 끝까지 봤으면 true, 중간에 닫았거나 광고를 못 띄웠으면 false.
// 딤드는 재시도하는 동안에도 계속 덮고 있다가 마지막에 한 번만 걷는다.
export async function ShowRewardedAd(): Promise<boolean> {
  if (!IsRealAdEnabled()) return ShowFakeAd(FAKE_REWARD_AD_SEC, true);

  const dim = ShowAdDim();
  try {
    for (let attempt = 1; attempt <= REWARD_AD_MAX_ATTEMPTS; attempt++) {
      const result = await RequestRewardedAd(dim);
      if (result.status !== "noAdPreloaded" || attempt === REWARD_AD_MAX_ATTEMPTS) return result.viewed;
      console.log(`${LOG_TAG} 보상형 광고 준비 안 됨 — ${REWARD_AD_RETRY_DELAY_MS}ms 뒤 다시 요청 (${attempt}/${REWARD_AD_MAX_ATTEMPTS})`);
      await new Promise((resolve) => setTimeout(resolve, REWARD_AD_RETRY_DELAY_MS));
    }
    return false;
  } finally {
    dim.Remove();
  }
}

// adBreak 보상형 1회 요청. status 는 adBreakDone 의 breakStatus(시작 응답이 없으면 "timeout").
function RequestRewardedAd(dim: AdDim): Promise<{ viewed: boolean; status: string }> {
  return new Promise((resolve) => {
    let started = false;
    let viewed = false;
    let done = false;
    const Finish = (status: string): void => {
      if (done) return;
      done = true;
      resolve({ viewed, status });
    };
    setTimeout(() => {
      if (!started) {
        console.warn(`${LOG_TAG} 보상형 광고 시작 응답 없음`);
        Finish("timeout");
      }
    }, AD_START_TIMEOUT_MS);

    PushAdBreak({
      type: "reward",
      name: "lobby_star",
      // 볼 수 있는 광고가 있을 때만 불린다 — 버튼으로 이미 동의를 받았으니 바로 재생한다.
      beforeReward: (show_ad) => {
        started = true;
        dim.HideSpinner();
        show_ad();
      },
      adViewed: () => {
        viewed = true;
      },
      adDismissed: () => {
        viewed = false;
      },
      // 광고를 띄웠든 못 띄웠든 항상 마지막에 불린다.
      adBreakDone: (placement_info) => {
        started = true;
        const status = placement_info.breakStatus ?? "-";
        console.log(`${LOG_TAG} 보상형 광고 종료 status=${status} viewed=${viewed}`);
        Finish(status);
      },
    });
  });
}

// 전면 광고 — 다 보거나 닫거나 못 띄우면 끝난다. 결과는 쓰지 않는다(보상 없음).
export function ShowInterstitialAd(): Promise<void> {
  if (!IsRealAdEnabled()) return ShowFakeAd(FAKE_INTERSTITIAL_AD_SEC, false).then(() => undefined);

  return new Promise((resolve) => {
    let started = false;
    let done = false;
    const dim = ShowAdDim();
    const Finish = (): void => {
      if (done) return;
      done = true;
      dim.Remove();
      resolve();
    };
    setTimeout(() => {
      if (!started) {
        console.warn(`${LOG_TAG} 전면 광고 시작 응답 없음`);
        Finish();
      }
    }, AD_START_TIMEOUT_MS);

    PushAdBreak({
      type: "next",
      name: "game_end",
      beforeAd: () => {
        started = true;
        dim.HideSpinner();
      },
      adBreakDone: (placement_info) => {
        started = true;
        console.log(`${LOG_TAG} 전면 광고 종료 status=${placement_info.breakStatus ?? "-"}`);
        Finish();
      },
    });
  });
}

// 개발용 가짜 광고 — 딤드 + 스피너로 잠깐 로딩을 보여준 뒤, 같은 딤드 위에 duration_sec 초를 센다.
// '닫기'를 누르면 중간에 끝난다. 끝까지 기다렸으면 true. is_reward 면 "끝까지 봐야 보상" 문구를 띄운다.
function ShowFakeAd(duration_sec: number, is_reward: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const dim = ShowAdDim();
    setTimeout(() => StartFakeAd(dim, duration_sec, is_reward, resolve), FAKE_AD_LOAD_MS);
  });
}

function StartFakeAd(dim: AdDim, duration_sec: number, is_reward: boolean, resolve: (completed: boolean) => void): void {
  dim.HideSpinner();
  const overlay = dim.element;
  overlay.style.background = "rgba(0,0,0,0.85)";

  const title = document.createElement("div");
  title.textContent = is_reward ? "광고 (개발용) — 끝까지 보면 star +1" : "광고 (개발용)";
  title.style.fontSize = "24px";

  const remain = document.createElement("div");
  remain.style.fontSize = "48px";

  const close_button = document.createElement("button");
  close_button.textContent = "닫기";
  close_button.style.cssText = "font-size:18px;padding:8px 24px;cursor:pointer;";

  overlay.append(title, remain, close_button);

  let left = duration_sec;
  remain.textContent = `${left}`;
  const timer = setInterval(() => {
    left -= 1;
    remain.textContent = `${left}`;
    if (left <= 0) Finish(true);
  }, 1000);

  function Finish(completed: boolean): void {
    clearInterval(timer);
    dim.Remove();
    console.log(`${LOG_TAG} 가짜 광고 종료 completed=${completed}`);
    resolve(completed);
  }

  close_button.addEventListener("click", () => Finish(false));
}
