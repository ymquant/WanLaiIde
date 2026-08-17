import type {
  HttpClientPort,
  HttpRequestOptions,
  HttpResponse,
} from "core/ports/httpClientPort";

export class HttpClientAdapter implements HttpClientPort {
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    const onAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeout);
        return { status: 0, bodyText: "" };
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(options.headers ?? {}),
      };
      let body: string | undefined;
      if (options.body !== undefined) {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
        body =
          typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body);
      }

      const res = await fetch(options.url, {
        method: options.method,
        headers,
        body,
        signal: controller.signal,
      });
      const bodyText = await res.text();
      return { status: res.status, bodyText };
    } catch {
      return { status: 0, bodyText: "" };
    } finally {
      clearTimeout(timeout);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  }
}
