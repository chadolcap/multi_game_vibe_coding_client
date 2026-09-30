// 브라우저 접속 URL 의 쿼리 파라미터를 읽는다. 예: http://localhost:5173/?mid=10000
export function GetQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}
