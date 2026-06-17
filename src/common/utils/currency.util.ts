export const APP_CURRENCY_CODE = "MRU";

export function formatMru(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(safeAmount))} ${APP_CURRENCY_CODE}`;
}
