import { z } from "zod";

// `settings` is checked against the plugin's own schema by the server, never here (ADR-0019 §7).
export const Slot = z.object({ plugin: z.string().min(1), settings: z.unknown() });
export type Slot = z.infer<typeof Slot>;

export const AppletDefinition = z.object({
	inputs: z.array(Slot).min(1),
	modifiers: z.array(Slot),
	outputs: z.array(Slot).min(1),
});
export type AppletDefinition = z.infer<typeof AppletDefinition>;
