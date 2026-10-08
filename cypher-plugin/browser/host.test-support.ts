import type {
  ControlUiHost,
  ControlUiPage,
  ControlUiViewContext,
} from "openclaw/plugin-sdk/control-ui";
import { vi } from "vitest";

export function createTestHost(
  response: (method: string, params: Record<string, unknown>) => Promise<unknown>,
) {
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const connection = {
    connected: true,
    canRead: true,
    canWrite: true,
    canGrant: true,
    canAdmin: true,
    assistantAgentId: null,
  };
  const pages = new Map<string, ControlUiPage>();
  const navigation = new Set<string>();
  const unusedComponent = () => {
    throw new Error("This view does not use host component services");
  };
  const unusedRegistration = () => {
    throw new Error("This plugin contributes only a page and navigation");
  };
  const host: ControlUiHost = {
    apiVersion: 1,
    pluginId: "cypher",
    signal: lifetime.signal,
    basePath: "",
    locale: "en",
    redact: (value) => value,
    connection,
    async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      // Synthetic RPC payloads cross the public transport's caller-selected response type here.
      return (await response(method, params)) as T;
    },
    onEvent: () => () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sessions: {
      rows: [],
      selectedKey: "",
      normalizeKey: (key) => key,
      refresh: async () => {},
      observe: () => ({ refresh: async () => {}, dispose: () => {} }),
      open: () => {},
      create: async () => null,
      patch: async () => {},
    },
    agents: {
      rows: [],
      selectedId: null,
      defaultId: null,
      scopeId: null,
      select: () => {},
      setScope: () => {},
      refresh: async () => {},
    },
    navigation: { openPage: () => {}, pageHref: ({ id }) => `/plugins/cypher/${id}` },
    components: {
      resolveAppearanceColor: () => "",
      mountAgentAvatar: unusedComponent,
      mountAppearancePicker: unusedComponent,
      mountAppearanceGlyph: unusedComponent,
      mountDialog: unusedComponent,
      mountAgentPicker: unusedComponent,
      mountSelectPicker: unusedComponent,
      mountSessionSummary: unusedComponent,
      mountDashboard: unusedComponent,
    },
    ui: {
      invalidate: () => {},
      registerPage(page) {
        pages.set(page.id, page);
        return () => {
          pages.delete(page.id);
        };
      },
      registerNavigation(item) {
        navigation.add(item.id);
        return () => {
          navigation.delete(item.id);
        };
      },
      registerPanel: unusedRegistration,
      registerAction: unusedRegistration,
      registerAccessory: unusedRegistration,
      registerWidget: unusedRegistration,
      registerReplacement: unusedRegistration,
      selectReplacement: () => {},
    },
  };
  const request = vi.spyOn(host, "request");
  return {
    host,
    request,
    connection,
    lifetime,
    pages,
    navigation,
    notify() {
      for (const listener of listeners) {
        listener();
      }
    },
    context: {
      host,
      signal: lifetime.signal,
      presented: true,
      props: {},
      mountDefault: () => () => {},
    } satisfies ControlUiViewContext,
  };
}
