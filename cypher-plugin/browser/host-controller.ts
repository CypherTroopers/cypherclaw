import type { ReactiveController, ReactiveControllerHost } from "lit";
import type {
  ControlUiConnection,
  ControlUiHost,
  ControlUiViewContext,
} from "openclaw/plugin-sdk/control-ui";

type RequestScope = {
  client: ControlUiHost;
  signal: AbortSignal;
  epoch: number;
};

type HostControllerOptions = {
  getContext: () => ControlUiViewContext | undefined;
  onIdentityChange?: () => void;
  invalidateRequests: () => void;
  ensureInitialData: () => void;
  onSnapshot?: () => void;
};

/** Adapts the public view lifetime to component-local requests; the host owns authority. */
export class PluginHostController implements ReactiveController {
  private bound: ControlUiViewContext | undefined;
  private unsubscribe: (() => void) | undefined;
  private epoch = 0;
  private active = false;
  private connectedBefore = false;
  private adminBefore = false;
  private readBefore = false;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly options: HostControllerOptions,
  ) {
    host.addController(this);
  }

  private connection(): ControlUiConnection | null {
    const context = this.options.getContext();
    if (
      !this.active ||
      !context ||
      !context.presented ||
      context.signal.aborted ||
      context.host.signal.aborted
    ) {
      return null;
    }
    return context.host.connection;
  }

  get connected(): boolean {
    return this.connection()?.connected === true;
  }

  get canRead(): boolean {
    const connection = this.connection();
    return connection?.connected === true && (connection.canRead || connection.canAdmin);
  }

  get canAdmin(): boolean {
    const connection = this.connection();
    return connection?.connected === true && connection.canAdmin;
  }

  capture(): RequestScope | null {
    const context = this.options.getContext();
    return context && this.connected
      ? { client: context.host, signal: context.signal, epoch: this.epoch }
      : null;
  }

  isCurrent(scope: RequestScope): boolean {
    const context = this.options.getContext();
    return (
      this.connected &&
      context?.host === scope.client &&
      context.signal === scope.signal &&
      this.epoch === scope.epoch
    );
  }

  private readonly retire = () => {
    this.epoch += 1;
    this.options.invalidateRequests();
    this.options.onSnapshot?.();
    this.host.requestUpdate();
  };

  hostConnected(): void {
    this.active = true;
    this.bind();
  }

  hostUpdate(): void {
    this.synchronize();
  }

  synchronize(): void {
    if (this.active) {
      this.bind();
    }
  }

  hostDisconnected(): void {
    this.active = false;
    this.release();
    this.connectedBefore = false;
    this.retire();
  }

  private release(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.bound?.signal.removeEventListener("abort", this.retire);
    this.bound?.host.signal.removeEventListener("abort", this.retire);
    this.bound = undefined;
  }

  private bind(): void {
    const context = this.options.getContext();
    if (context?.host !== this.bound?.host || context?.signal !== this.bound?.signal) {
      const replacing = this.bound !== undefined;
      this.release();
      this.epoch += 1;
      this.options.invalidateRequests();
      if (replacing) {
        this.options.onIdentityChange?.();
      }
      this.connectedBefore = false;
      this.bound = context;
      if (context && !context.signal.aborted && !context.host.signal.aborted) {
        this.unsubscribe = context.host.subscribe(() => this.sync());
        context.signal.addEventListener("abort", this.retire, { once: true });
        context.host.signal.addEventListener("abort", this.retire, { once: true });
      }
    }
    this.sync();
  }

  private sync(): void {
    const connected = this.connected;
    const canAdmin = this.canAdmin;
    const canRead = this.canRead;
    const changed =
      connected !== this.connectedBefore ||
      canAdmin !== this.adminBefore ||
      canRead !== this.readBefore;
    this.connectedBefore = connected;
    this.adminBefore = canAdmin;
    this.readBefore = canRead;
    if (changed) {
      this.epoch += 1;
      this.options.invalidateRequests();
      this.options.onSnapshot?.();
      if (connected && canRead) {
        this.options.ensureInitialData();
      }
      this.host.requestUpdate();
    }
  }
}
