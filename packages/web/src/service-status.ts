import type { ServiceStatus } from "./api-client.ts";

type Status = ServiceStatus["status"];

/** How a service's status reads on settings and in its wizard. */
export function statusDetail(status: Status): string {
	if (status.kind === "failed") return status.failure.message;
	return status.kind === "connected" ? "connected" : "not connected";
}

/** The action that opens a service's wizard: ✎ to edit a grant, else what the grant needs. */
export const wizardAction: Record<Status["kind"], string> = {
	connected: "✎",
	"not-connected": "connect",
	failed: "reconnect",
};
