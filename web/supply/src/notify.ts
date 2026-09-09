import type { ItemStatus } from "./types";
import { formatDaysLeft } from "./model";

export async function requestNotifyPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function pingIfNeeded(alerts: ItemStatus[], enabled: boolean): void {
  if (!enabled || !alerts.length) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const urgent = alerts.filter((a) => a.alert === "urgent");
  const soon = alerts.filter((a) => a.alert === "soon");
  const top = (urgent[0] ?? soon[0]).item.name;
  const extra = alerts.length - 1;
  const body =
    extra > 0
      ? `${top} and ${extra} more. ${formatDaysLeft(urgent[0] ?? soon[0])}.`
      : `${top}: ${formatDaysLeft(alerts[0])}. Place an order if you haven’t.`;

  try {
    new Notification("Coastal Supply", {
      body,
      icon: "./logo.svg",
      tag: "coastal-supply-low",
    });
  } catch {
    // Some browsers require a service worker for notifications.
  }
}
