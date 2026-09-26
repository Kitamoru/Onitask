/**
 * iCalendar parsing for the Yandex CalDAV sync.
 *
 * Split out of `index.ts` so it can be unit tested. The Edge Function entry
 * point runs under Deno with `@ts-nocheck` and remote URL imports, which vitest
 * cannot import; this module has no imports at all, so both sides can use it.
 *
 * The part that matters most is TZID handling. Yandex writes
 *   DTSTART;TZID=Europe/Moscow:20260814T100000
 * and the property parameters used to be discarded by the matching regex, which
 * left a floating time that was then read in the runtime's local zone — UTC on
 * Edge Functions. A 10:00 Moscow event was stored as 10:00 UTC and shown three
 * hours late. See `parseIcalDate`.
 */

/**
 * Unescapes an iCalendar TEXT value. Yandex escapes newlines as \n; a raw
 * replace alone would leave literal backslash-n in titles.
 */
export function unfoldIcalText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Offset in ms between UTC and `timeZone` at the given instant.
 * Deno has no Temporal, so this goes through Intl.DateTimeFormat. Throws if
 * the runtime does not know the zone.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    // Some locales render midnight as hour 24 under hour12:false.
    field('hour') % 24,
    field('minute'),
    field('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * Converts a wall-clock reading in `timeZone` into the equivalent UTC instant.
 * Two passes, because the offset we are correcting for itself depends on the
 * instant — which is what makes this correct across a DST boundary.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month, day, hour, minute, second);
  const firstPass = new Date(naive - timeZoneOffsetMs(new Date(naive), timeZone));
  return new Date(naive - timeZoneOffsetMs(firstPass, timeZone));
}

/**
 * Parses an iCalendar DATE or DATE-TIME into an ISO string.
 *
 * `timeZone` is the property's TZID parameter; see the file header for why it
 * cannot be dropped. A `Z`-suffixed value is already an instant and ignores the
 * zone. A bare 8-character value is VALUE=DATE and is stored as UTC midnight.
 */
export function parseIcalDate(raw: string, timeZone?: string): string {
  const value = raw.trim();
  const isUtc = value.endsWith('Z');
  const bare = value.replace(/[-:]/g, '').replace(/Z$/, '');

  if (bare.length === 8) {
    // VALUE=DATE: a date with no time of day, stored as UTC midnight.
    return new Date(Date.UTC(
      parseInt(bare.slice(0, 4)), parseInt(bare.slice(4, 6)) - 1, parseInt(bare.slice(6, 8)),
    )).toISOString();
  }

  if (bare.length >= 15) {
    const y = parseInt(bare.slice(0, 4));
    const mo = parseInt(bare.slice(4, 6)) - 1;
    const d = parseInt(bare.slice(6, 8));
    const h = parseInt(bare.slice(9, 11));
    const mi = parseInt(bare.slice(11, 13));
    const s = parseInt(bare.slice(13, 15));

    if (isUtc) return new Date(Date.UTC(y, mo, d, h, mi, s)).toISOString();

    if (timeZone) {
      try {
        return zonedWallTimeToUtc(y, mo, d, h, mi, s, timeZone).toISOString();
      } catch {
        // Unknown zone for this runtime — fall through to the old reading.
      }
    }
    return new Date(y, mo, d, h, mi, s).toISOString();
  }

  return new Date(value).toISOString();
}

export interface ParsedEvent {
  uid: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  /** iCal VALUE=DATE: a whole date, not an instant on a clock. */
  isAllDay: boolean;
}

const FALLBACK_TITLE = 'Без названия';

export function parseVEvents(xml: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const blocks = xml.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  for (const block of blocks) {
    // Unfold RFC 5545 continuation lines before matching.
    const unfolded = block.replace(/\r?\n[ \t]/g, '');

    const uid = (unfolded.match(/^UID:(.+)$/m)?.[1] || '').trim();
    const summaryRaw = unfolded.match(/^SUMMARY(?:;[^:]*)?:(.*)$/m)?.[1];
    const descriptionRaw = unfolded.match(/^DESCRIPTION(?:;[^:]*)?:(.*)$/m)?.[1];
    // Keep the property parameters — TZID lives there and is the only thing
    // that tells us which zone a floating DTSTART should be read in.
    const dtStart = unfolded.match(/^DTSTART([^:\r\n]*):([^\r\n]+)/m);
    const dtStartRaw = dtStart?.[2];
    const startTzid = dtStart?.[1].match(/TZID=([^;:]+)/)?.[1]?.trim();
    const dtEnd = unfolded.match(/^DTEND([^:\r\n]*):([^\r\n]+)/m);
    const dtEndRaw = dtEnd?.[2];
    const endTzid = dtEnd?.[1].match(/TZID=([^;:]+)/)?.[1]?.trim();

    if (!uid || !dtStartRaw) continue;

    const startAt = parseIcalDate(dtStartRaw, startTzid);
    let endAt = startAt;
    if (dtEndRaw) {
      // DTEND often omits TZID and inherits it from DTSTART.
      try { endAt = parseIcalDate(dtEndRaw, endTzid ?? startTzid); } catch { endAt = startAt; }
    }

    // VALUE=DATE is the explicit marker; an 8-character value is the same thing
    // written without parameters, so treat both as all-day.
    const isAllDay =
      /VALUE=DATE/i.test(dtStart?.[1] ?? '') || dtStartRaw.replace(/[-:]/g, '').replace(/Z$/, '').length === 8;

    events.push({
      uid,
      isAllDay,
      title: summaryRaw ? unfoldIcalText(summaryRaw) || FALLBACK_TITLE : FALLBACK_TITLE,
      description: descriptionRaw ? unfoldIcalText(descriptionRaw) || null : null,
      startAt,
      // Guard an inverted range; the DB trigger would reject end_at < start_at.
      endAt: endAt < startAt ? startAt : endAt,
    });
  }

  return events;
}
