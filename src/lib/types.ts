export interface TimeRecord {
  id: string;
  date: string;        // YYYY-MM-DD
  timeIn: string;      // HH:MM
  timeOut: string | null;
  totalHours: number | null;
  status: "Working" | "Completed" | "Note" | "WFH" | "Leave";
  notes?: string;
}