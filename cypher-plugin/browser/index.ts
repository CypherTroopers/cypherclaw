import { defineControlUiPlugin, type ControlUiView } from "openclaw/plugin-sdk/control-ui";
import { CypherPage } from "./node-page.ts";
import "./style.css";

const mountCypher: ControlUiView = (container, context) => {
  const page = new CypherPage();
  page.className = "cypher-plugin";
  page.updateContext(context);
  container.append(page);
  const dispose = () => page.remove();
  context.signal.addEventListener("abort", dispose, { once: true });
  return {
    update(next) {
      page.updateContext(next);
    },
    dispose() {
      context.signal.removeEventListener("abort", dispose);
      dispose();
    },
  };
};

export default defineControlUiPlugin({
  id: "cypher",
  activate(host) {
    const disposePage = host.ui.registerPage({ id: "cypher", label: "Cypher", mount: mountCypher });
    const disposeNavigation = host.ui.registerNavigation({
      id: "cypher",
      label: "Cypher",
      page: { id: "cypher" },
      icon: "coins",
      order: 20,
    });
    return () => {
      disposeNavigation();
      disposePage();
    };
  },
});
