import { assertPublicHttpUrl } from "./security.js";

const withTimedBody = (response, timeoutMs, state) => {
  const clear = () => {
    clearTimeout(state.timer);
    state.signal?.removeEventListener("abort", state.onAbort);
  };
  if (!response.body) {
    clear();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clear();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        clear();
        controller.error(state.timedOut ? new Error(`Request timed out after ${timeoutMs} ms`) : error);
      }
    },
    async cancel(reason) {
      clear();
      await reader.cancel(reason);
    }
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};

/**
 * Worker outbound fetches must declare a fixed provider allowlist. DNS A/AAAA
 * answers are checked before every request and redirect. Workers fetch does not
 * expose a socket lookup hook, so user-controlled destination fetches are not
 * supported here; those routes are disabled in the Worker build.
 */
export const safeFetch = async (input, options = {}, timeoutMs = 20_000) => {
  const { allowedHosts, allowHttp = false, maxRedirects = 4, ...fetchOptions } = options;
  if (!Array.isArray(allowedHosts) || !allowedHosts.length) {
    throw new Error("Outbound request blocked: Workers requires an explicit provider allowlist");
  }

  const controller = new AbortController();
  const externalSignal = fetchOptions.signal;
  const state = { timedOut: false, signal: externalSignal, onAbort: null, timer: null };
  let rejectTimeout;
  const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
  state.onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  else externalSignal?.addEventListener("abort", state.onAbort, { once: true });

  state.timer = setTimeout(() => {
    state.timedOut = true;
    const timeoutError = new Error(`Request timed out after ${timeoutMs} ms`);
    controller.abort(timeoutError);
    rejectTimeout(timeoutError);
  }, timeoutMs);

  try {
    let currentUrl = await Promise.race([assertPublicHttpUrl(input, { allowedHosts, allowHttp }), timeoutPromise]);
    const method = String(fetchOptions.method || "GET").toUpperCase();
    let headers = new Headers(fetchOptions.headers || {});
    let response;

    for (let redirectCount = 0; ; redirectCount++) {
      await Promise.race([assertPublicHttpUrl(currentUrl.href, { allowedHosts, allowHttp }), timeoutPromise]);
      const requestOptions = {
        ...fetchOptions,
        method,
        headers,
        redirect: "manual",
        signal: controller.signal
      };
      response = await Promise.race([fetch(currentUrl.href, requestOptions), timeoutPromise]);

      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
      if (redirectCount >= maxRedirects) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Terlalu banyak pengalihan URL");
      }
      if (!["GET", "HEAD"].includes(method)) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Pengalihan tidak diizinkan untuk request non-GET/HEAD");
      }
      const nextUrl = new URL(location, currentUrl);
      if (currentUrl.protocol === "https:" && nextUrl.protocol !== "https:") {
        await response.body?.cancel().catch(() => {});
        throw new Error("Pengalihan ke koneksi non-HTTPS ditolak");
      }
      if (nextUrl.origin !== currentUrl.origin) {
        headers = new Headers(headers);
        headers.delete("authorization");
        headers.delete("cookie");
        headers.delete("proxy-authorization");
      }
      await response.body?.cancel().catch(() => {});
      currentUrl = await Promise.race([assertPublicHttpUrl(nextUrl.href, { allowedHosts, allowHttp }), timeoutPromise]);
    }

    return withTimedBody(response, timeoutMs, state);
  } catch (error) {
    clearTimeout(state.timer);
    externalSignal?.removeEventListener("abort", state.onAbort);
    if (state.timedOut) throw new Error(`Request timed out after ${timeoutMs} ms`);
    throw error;
  }
};
