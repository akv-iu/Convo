/** Bounded JSON for fixed provider hosts; callers classify HTTP/timeout errors separately. */
export async function readProviderJson(response: Response): Promise<unknown> {
  const maximum = 1024 * 1024;
  try {
    if (Number(response.headers.get("Content-Length")) > maximum
      || !/^application\/(?:json|[^;\s]+\+json)(?:;|$)/i.test(response.headers.get("Content-Type") ?? "")) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maximum) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // Provider/stream/JSON errors can contain response text or credentials.
    throw new Error("Invalid provider response");
  }
}
