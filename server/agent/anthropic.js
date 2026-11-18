const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 呼叫 Anthropic Messages API，遇到 429 / 5xx / 網路錯誤會自動重試
export async function createMessage(body, { apiKey, version, baseUrl }) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": version,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10 * 60 * 1000)
      });
    } catch (err) {
      lastError = err;
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.ok) return res.json();

    const text = await res.text();
    lastError = new Error(`Anthropic API ${res.status}: ${text.slice(0, 800)}`);
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      await sleep(Math.max(retryAfter * 1000, 2000 * 2 ** attempt));
      continue;
    }
    throw lastError;
  }
  throw lastError;
}
