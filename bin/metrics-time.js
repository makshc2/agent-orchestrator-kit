const DISPLAY_TIMEZONE = 'Europe/Kyiv';

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function parseFlexibleIso(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  let raw = String(value).trim();
  if (!raw) return NaN;
  raw = raw.replace(/^(\d{4}-\d{2}-\d{2})[ ]+(\d{2}:)/, '$1T$2');
  raw = raw.replace(/(\.\d{3})\d*\.000(?=Z$|[+-]\d{2}:?\d{2}$)/i, '$1');
  raw = raw.replace(/(\.\d{3})\d+(?=Z$|[+-]\d{2}:?\d{2}$)/i, '$1');
  raw = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) raw += 'Z';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : NaN;
}

export function formatUtcIso(value) {
  const ms = parseFlexibleIso(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function nowUtcIso(now = Date.now()) {
  return formatUtcIso(now);
}

function kyivOffset(ms) {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIMEZONE,
    timeZoneName: 'longOffset',
    hour: '2-digit',
  });
  const name = fmt.formatToParts(d).find((part) => part.type === 'timeZoneName')?.value || '';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (match) {
    return `${match[1]}${pad2(match[2])}:${match[3] || '00'}`;
  }
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const kyiv = new Date(d.toLocaleString('en-US', { timeZone: DISPLAY_TIMEZONE })).getTime();
  const minutes = Math.round((kyiv - utc) / 60000);
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

function formatKyivIso(value) {
  const ms = parseFlexibleIso(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: DISPLAY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(ms % 1000).padStart(3, '0')}${kyivOffset(ms)}`;
}

export function formatKyivDisplay(value) {
  const iso = formatKyivIso(value);
  if (!iso) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-]\d{2}:\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}:${match[6]} (Київ ${match[7]})`;
}

export function isoOrNull(value) {
  if (value == null || value === '') return null;
  return formatUtcIso(value);
}

export function laterTimestamp(a, b) {
  const left = parseFlexibleIso(a);
  const right = parseFlexibleIso(b);
  if (!Number.isFinite(left)) return b;
  if (!Number.isFinite(right)) return a;
  return left >= right ? a : b;
}

export function earlierTimestamp(a, b) {
  const left = parseFlexibleIso(a);
  const right = parseFlexibleIso(b);
  if (!Number.isFinite(left)) return b;
  if (!Number.isFinite(right)) return a;
  return left <= right ? a : b;
}
