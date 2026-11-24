import { supabase } from "./supabase";
import { withTimeout } from "./network";

/**
 * The signed-in user's office for auto punch, stored in `office_locations`.
 *
 * Supabase holds it so a reinstall or a second phone restores it; the native
 * plugin keeps the live copy and does the geofencing. Queries filter on
 * user_id explicitly, like every other per-user query in the app.
 */

export const DEFAULT_RADIUS_M = 200;
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 500;

export interface OfficeLocation {
  lat: number;
  lng: number;
  radiusM: number;
  enabled: boolean;
}

interface OfficeRow {
  lat: number;
  lng: number;
  radius_m: number;
  enabled: boolean;
}

export async function getOffice(userId: string): Promise<OfficeLocation | null> {
  const { data, error } = await withTimeout(
    supabase
      .from("office_locations")
      .select("lat, lng, radius_m, enabled")
      .eq("user_id", userId)
      .maybeSingle()
  );
  if (error) throw error;
  if (!data) return null;
  const row = data as OfficeRow;
  return { lat: row.lat, lng: row.lng, radiusM: row.radius_m, enabled: row.enabled };
}

export async function saveOffice(userId: string, office: OfficeLocation): Promise<void> {
  const { error } = await withTimeout(
    supabase.from("office_locations").upsert(
      {
        user_id: userId,
        lat: office.lat,
        lng: office.lng,
        radius_m: Math.round(office.radiusM),
        enabled: office.enabled,
      },
      { onConflict: "user_id" }
    )
  );
  if (error) throw error;
}

export async function deleteOffice(userId: string): Promise<void> {
  const { error } = await withTimeout(
    supabase.from("office_locations").delete().eq("user_id", userId)
  );
  if (error) throw error;
}
