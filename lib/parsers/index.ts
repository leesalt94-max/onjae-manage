import type { Channel, ParseResult } from "../types";
import { parseAirbnb } from "./airbnb";
import { parseBooking } from "./booking";
import { parseCsv } from "./common";
import { parseTrip } from "./trip";

const PARSERS: Record<Channel, (rows: ReturnType<typeof parseCsv>) => ParseResult> = {
  airbnb: parseAirbnb,
  booking: parseBooking,
  trip: parseTrip,
};

export function parseExport(channel: Channel, csvText: string): ParseResult {
  return PARSERS[channel](parseCsv(csvText));
}
