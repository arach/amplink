import { AmplinkSession } from "./amplink-session.ts";
import { AmplinkControlHub } from "./control-hub.ts";
import { AmplinkRelayRoom } from "./relay-room.ts";
import { handleWorkerFetch } from "./worker-app.ts";

export { AmplinkControlHub, AmplinkRelayRoom, AmplinkSession };

export default {
  fetch: handleWorkerFetch,
} satisfies ExportedHandler<CloudflareEnv>;
