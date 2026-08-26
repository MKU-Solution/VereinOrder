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

export const formatUptime = (seconds: number): string => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "0s";
  }
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
};

export const formatCurrency = (cents: number): string => {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "€ 0,00";
  return (cents / 100).toLocaleString("de-AT", {
    style: "currency",
    currency: "EUR",
  });
};
