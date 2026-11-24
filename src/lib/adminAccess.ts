import { Capacitor } from "@capacitor/core";

/**
 * Whether the admin team view should be reachable for this user.
 *
 * Single source of truth for both the `/admin` route guard and the nav tab — if
 * those two conditions ever drifted apart you'd get a tab leading to a redirect,
 * or a hidden page still reachable by URL.
 *
 * Web-only: the team table is wide and the Android build ships the same bundle,
 * so on a phone the route is simply unreachable rather than cramped.
 *
 * This is presentation, not security. Row-level security is what actually stops
 * a non-admin reading other people's records — a user who forced their way to
 * the page would see an empty table, not someone else's timesheet.
 */
export function canSeeAdmin(isAdmin: boolean): boolean {
  return isAdmin && !Capacitor.isNativePlatform();
}
