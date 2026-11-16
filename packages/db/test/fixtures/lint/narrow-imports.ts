import { authStore } from "@ultrasonics/db/auth-store";
import { systemModule } from "@ultrasonics/db/system";
import { v1ImportStore } from "@ultrasonics/db/v1-import";

export const narrowModules = [authStore, systemModule, v1ImportStore];
