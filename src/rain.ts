import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RainReading {
  mm: number;
  at: string; // ISO timestamp
  userId: number;
  chatId: number;
  messageId: number;
}

interface RainLogFile {
  readings: RainReading[];
}

// Accepts a message that is nothing but a millimetre reading, e.g. "7", "7.5", "7,5".
export function parseRainMm(text: string): number | undefined {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return undefined;

  const mm = Number(`${match[1]}.${match[2] ?? "0"}`);
  if (!Number.isFinite(mm) || mm <= 0 || mm > 500) return undefined;
  return mm;
}

// Monday 00:00 in the process-local timezone. Set TZ so this matches your clock.
export function startOfWeek(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

export function formatMm(mm: number): string {
  return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
}

export class RainLog {
  private readings: RainReading[] = [];

  private constructor(private readonly filePath: string) {}

  static async open(filePath: string): Promise<RainLog> {
    const log = new RainLog(filePath);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as RainLogFile;
      log.readings = Array.isArray(parsed.readings) ? parsed.readings : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return log;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const body = JSON.stringify({ readings: this.readings } satisfies RainLogFile, null, 2);
    await writeFile(tmpPath, `${body}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }

  async add(reading: RainReading): Promise<void> {
    this.readings.push(reading);
    await this.persist();
  }

  readingsThisWeek(now: Date = new Date()): RainReading[] {
    const cutoff = startOfWeek(now).getTime();
    return this.readings.filter((reading) => Date.parse(reading.at) >= cutoff);
  }

  totalThisWeek(now: Date = new Date()): number {
    const sum = this.readingsThisWeek(now).reduce((total, reading) => total + reading.mm, 0);
    return Math.round(sum * 10) / 10;
  }

  async undoLastThisWeek(now: Date = new Date()): Promise<RainReading | undefined> {
    const cutoff = startOfWeek(now).getTime();
    for (let i = this.readings.length - 1; i >= 0; i--) {
      const reading = this.readings[i];
      if (reading && Date.parse(reading.at) >= cutoff) {
        const [removed] = this.readings.splice(i, 1);
        await this.persist();
        return removed;
      }
    }
    return undefined;
  }
}
