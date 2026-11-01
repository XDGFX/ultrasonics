import { createSelectSchema } from "drizzle-zod";
import type { z } from "zod";
import { AppletDefinition } from "./applet-definition.ts";
import { Schedule } from "./schedule.ts";
import { applets } from "./schema.ts";

export const Applet = createSelectSchema(applets, {
	definition: AppletDefinition,
	schedule: Schedule.nullable(),
});
export type Applet = z.infer<typeof Applet>;

export const NewApplet = Applet.pick({ name: true, definition: true, enabled: true }).partial({
	enabled: true,
});
export type NewApplet = z.input<typeof NewApplet>;

export const AppletChanges = Applet.pick({ name: true, definition: true, enabled: true }).partial();
export type AppletChanges = z.input<typeof AppletChanges>;
