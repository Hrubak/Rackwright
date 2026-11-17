export type Units = "mm" | "in";
export type StartScreen = "new" | "last" | "clients" | "racks";
export interface Prefs { units?: Units; start?: StartScreen; last_rack?: { id?: number; path?: string; name?: string }; [k: string]: unknown }
export interface SystemSettings { company_name?: string; accent?: string; rack_default_model?: string; rack_default_u?: number; [k: string]: unknown }
export interface Branding { company_name: string; accent: string | null; logo_url: string | null }
