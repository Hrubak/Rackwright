export type Units = "mm" | "in";
export type StartScreen = "new" | "last" | "clients" | "racks";
export type ThemePref = "dark" | "light" | "system";
export interface Prefs { theme?: ThemePref; units?: Units; start?: StartScreen; last_rack?: { id?: number; path?: string; name?: string }; [k: string]: unknown }
export interface SystemSettings { company_name?: string; accent?: string; rack_default_model?: string; rack_default_u?: number; report_secondary?: string; address_line?: string; report_font_name?: string; [k: string]: unknown }
export interface Branding { company_name: string; accent: string | null; logo_url: string | null }
export type AssetName = "logo" | "font_regular" | "font_bold" | "cover_art" | "header_art" | "footer_art";
