export interface ReminderInput {
  /** What is happening. Required. */
  title: string;
  /** Date, epoch ms, ISO string with Z/offset, or local "YYYY-MM-DD HH:mm" read in `timeZone`. */
  start: Date | number | string;
  /** IANA zone for a local `start` string, and the host's zone shown on the ticket (`z`). Defaults to the system zone. */
  timeZone?: string;
  /** Length in minutes, 1–1440. Default 60. */
  durationMinutes?: number;
  /** A place or a link. */
  location?: string;
  notes?: string;
  host?: string;
}

export interface Reminder {
  title: string;
  start: Date;
  durationMinutes: number;
  location: string;
  notes: string;
  host: string;
  /** The host's IANA time zone, or "" when the link doesn't carry one. */
  timeZone: string;
}

export interface BaseOptions {
  base?: string;
  /** Make a private link (`/#…`), which never reaches a server and shows no preview. Default false: a shared `/r/…` link. */
  private?: boolean;
}
export interface PathOptions { private?: boolean }
/** What parse() found in a line. `start` is null when there is no time; `dur` (minutes) is null when there is no length. */
export interface Parsed {
  title: string;
  start: Date | null;
  dur: number | null;
  place: string;
  tokens: { type: "place" | "date" | "time" | "relative" | "duration" | "zone"; text: string }[];
}
export interface ThemeOptions { theme?: "light" | "dark" }

export const VERSION: string;
export const DEFAULT_BASE: string;
export function encode(event: ReminderInput): string;
export function createLink(event: ReminderInput, options?: BaseOptions): string;
export function toPath(event: ReminderInput, options?: PathOptions): string;
export function decode(linkOrFragment: string): Reminder | null;
export function fromQuery(query: string | URLSearchParams | Record<string, string>, options?: { timeZone?: string }): (ReminderInput & { start: Date; timeZone: string }) | null;
export function parse(text: string, options?: { now?: Date; timeZone?: string }): Parsed;
export function describeWhen(start: Date | number, timeZone?: string): string;
export function parseStart(value: Date | number | string, timeZone?: string): Date;
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date;
export function systemTimeZone(): string;
export function description(event: ReminderInput, options?: BaseOptions): string;
export function toICS(event: ReminderInput, options?: BaseOptions & { alarms?: number[] }): string;
export function googleCalendarUrl(event: ReminderInput, options?: BaseOptions): string;
export function outlookUrl(event: ReminderInput, options?: BaseOptions & { office?: boolean }): string;
export function badgeSVG(options?: ThemeOptions): string;
export function badgeHTML(link: string, options?: ThemeOptions): string;
export function badgeMarkdown(link: string, options?: ThemeOptions): string;
/** The reminder card's address for a shared link (…/embed/<payload>). Throws for private links. */
export function embedURL(link: string, options?: { theme?: "light" | "dark" }): string;
/** An iframe snippet with the reminder card, 112 pixels tall. Throws for private links. */
export function embedHTML(link: string, options?: { theme?: "light" | "dark" }): string;

declare const remmynd: {
  VERSION: typeof VERSION; DEFAULT_BASE: typeof DEFAULT_BASE; createLink: typeof createLink; toPath: typeof toPath; encode: typeof encode;
  decode: typeof decode; fromQuery: typeof fromQuery; parse: typeof parse; describeWhen: typeof describeWhen; parseStart: typeof parseStart; zonedTime: typeof zonedTime; systemTimeZone: typeof systemTimeZone;
  description: typeof description; toICS: typeof toICS; googleCalendarUrl: typeof googleCalendarUrl; outlookUrl: typeof outlookUrl;
  badgeSVG: typeof badgeSVG; badgeHTML: typeof badgeHTML; badgeMarkdown: typeof badgeMarkdown;
  embedURL: typeof embedURL; embedHTML: typeof embedHTML;
};
export default remmynd;
