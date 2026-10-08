import { html, nothing, type TemplateResult } from "lit";

export function renderSettingsPage(body: unknown): TemplateResult {
  return html`<div class="settings-page">${body}</div>`;
}

export function renderSettingsWorkspace(body: unknown): TemplateResult {
  return html`<section class="settings-workspace">
    <div class="settings-workspace__body">${body}</div>
  </section>`;
}

export function renderSettingsPageHeader(props: {
  title: string;
  subtitle: string;
  actions?: TemplateResult;
}): TemplateResult {
  return html`<header class="content-header content-header--settings">
    <div>
      <h1 class="page-title">${props.title}</h1>
      <p class="page-subtitle">${props.subtitle}</p>
    </div>
    <div class="page-header-actions">${props.actions ?? nothing}</div>
  </header>`;
}

export function renderSettingsSection(
  props: { title: string; description: string },
  rows: unknown,
): TemplateResult {
  return html`<section class="settings-section">
    <div class="settings-section__header">
      <div class="settings-section__copy">
        <h2 class="settings-section__heading">${props.title}</h2>
        <p class="settings-section__desc">${props.description}</p>
      </div>
    </div>
    <div class="settings-group">${rows}</div>
  </section>`;
}

export function renderSettingsRow(props: {
  title: string;
  description?: string;
  control?: TemplateResult;
  stacked?: boolean;
  role?: "alert" | "status";
}): TemplateResult {
  return html`<div
    class=${`settings-row${props.stacked ? " settings-row--stacked" : ""}`}
    role=${props.role ?? nothing}
  >
    <div class="settings-row__text">
      <span class="settings-row__title">${props.title}</span
      >${props.description ? html`<span class="settings-row__desc">${props.description}</span>` : nothing}
    </div>
    ${props.control ? html`<div class="settings-row__control">${props.control}</div>` : nothing}
  </div>`;
}

export function renderSettingsStatus(props: {
  kind: "danger" | "ok" | "muted";
  label: string;
}): TemplateResult {
  return html`<span class=${`settings-status settings-status--${props.kind}`}
    ><span class="settings-status__dot"></span><span>${props.label}</span></span
  >`;
}
