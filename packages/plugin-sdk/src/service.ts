import { z } from "zod";

/**
 * What a grant is for (ADR-0013 §2). Each plugin port adds its service here; two plugins naming
 * the same service share one grant.
 */
export const services = ["spotify", "plex"] as const;

export const Service = z.enum(services);
export type Service = z.infer<typeof Service>;
