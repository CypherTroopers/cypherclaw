import { html } from "lit";

type TabOption<T extends string> = { value: T; label: string; testId: string };

/** Native buttons keep this strip independent of the host's component registry. */
export function renderHubTabs<T extends string>(props: {
  id: string;
  active: T;
  tabs: TabOption<T>[];
  ariaLabel: string;
  onSelect: (tab: T) => void;
}) {
  return html`<div
    class="cypher-hub-tabs"
    role="tablist"
    aria-label=${props.ariaLabel}
    @keydown=${(event: KeyboardEvent) => {
      const tab = event.target;
      if (!(tab instanceof HTMLButtonElement)) {
        return;
      }
      const current = props.tabs.findIndex((item) => `${props.id}-tab-${item.value}` === tab.id);
      if (current < 0) {
        return;
      }
      const next =
        event.key === "ArrowRight"
          ? (current + 1) % props.tabs.length
          : event.key === "ArrowLeft"
            ? (current - 1 + props.tabs.length) % props.tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? props.tabs.length - 1
                : null;
      if (next === null) {
        return;
      }
      event.preventDefault();
      const item = props.tabs[next];
      if (item) {
        tab.parentElement
          ?.querySelector<HTMLButtonElement>(`#${props.id}-tab-${item.value}`)
          ?.focus();
      }
    }}
  >
    ${props.tabs.map(
      (tab) => html`<button
        type="button"
        role="tab"
        class="hub-tab"
        id=${`${props.id}-tab-${tab.value}`}
        aria-controls=${`${props.id}-panel-${tab.value}`}
        aria-selected=${props.active === tab.value ? "true" : "false"}
        tabindex=${props.active === tab.value ? 0 : -1}
        data-test-id=${tab.testId}
        @click=${() => props.onSelect(tab.value)}
      >
        ${tab.label}
      </button>`,
    )}
  </div>`;
}
