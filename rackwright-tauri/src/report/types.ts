export interface ReportOptions {
  level: "overview" | "detailed";
  sites: number[] | "all";
  summary: string;
  recommendations: string;
  date: string; // YYYY-MM-DD
  prepared_for: string;
}
