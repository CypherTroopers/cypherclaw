import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerCypherMethods } from "./src/handlers.js";
import { CypherPluginService } from "./src/service.js";

export default definePluginEntry({
  id: "cypher",
  name: "Cypher",
  description: "Cypher node management and independent wallet generation.",
  register(api) {
    if (!api.rootDir) {
      throw new Error(
        "OpenClaw did not provide the Cypher plugin directory. Update OpenClaw and reinstall the plugin.",
      );
    }
    const service = new CypherPluginService(api.rootDir);
    api.registerService({
      id: "cypher",
      start: (context) => service.start(context.stateDir),
      stop: () => service.stop(),
    });
    api.session.controls.registerControlUiDescriptor({
      surface: "tab",
      id: "cypher",
      label: "Cypher",
      slug: "cypher",
      icon: "coins",
      group: "control",
      requiredScopes: ["operator.read"],
    });
    registerCypherMethods(api, service);
  },
});
