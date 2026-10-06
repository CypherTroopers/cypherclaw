import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("cypher"),
  component: () =>
    import("./cypher-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-cypher-page></openclaw-cypher-page>`,
    })),
});
