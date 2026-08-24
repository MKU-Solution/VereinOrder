export const backendMessage = (error: unknown, fallback: string): string => {
  const message = (error as any)?.response?.data?.message;
  if (typeof message === "string" && message.trim().length > 0) return message;
  if (Array.isArray(message) && typeof message[0] === "string") {
    return message[0];
  }
  return fallback;
};

export const formatStorageBytes = (value: unknown): string => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "unbekannt";
  }
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${value} B`;
};
