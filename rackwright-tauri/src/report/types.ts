export interface ReportOptions {
  level: "overview" | "detailed";
  sites: number[] | "all";
  summary: string;
  recommendations: string;
  date: string; // YYYY-MM-DD
  prepared_for: string;
  /** VM migration plan section; on unless false. */
  migration?: boolean;
}
