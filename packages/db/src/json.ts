import { z } from "zod";

export const JsonValue = z.json();
export type JsonValue = z.infer<typeof JsonValue>;

export const JsonObject = z.record(z.string(), JsonValue);
export type JsonObject = z.infer<typeof JsonObject>;
