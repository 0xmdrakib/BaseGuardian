export async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as any;
      if (body && body.error) {
        message = body.error;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}
