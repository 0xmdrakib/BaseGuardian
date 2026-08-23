export function safeServerError(error: unknown) {
  if (!error || typeof error !== "object") {
    return { name: "UnknownError" };
  }
  const value = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
  };
  return {
    name: typeof value.name === "string" ? value.name : "UnknownError",
    ...(typeof value.code === "number" || typeof value.code === "string"
      ? { code: String(value.code).slice(0, 40) }
      : {}),
    ...(typeof value.status === "number" ? { status: value.status } : {}),
  };
}
