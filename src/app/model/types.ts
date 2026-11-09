import type {
  AppSettings,
  PawchiveConfig,
  Route,
  TabName,
  UpdateInfo,
} from "../../types";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

export type IndexState = "idle" | "syncing" | "ready" | "error";

export interface TabStack {
  stack: Route[];
  index: number;
}

export type TabStacks = Record<TabName, TabStack>;

export interface AppStore {
  settings: AppSettings;
  config: PawchiveConfig;
  route: Route;
  previousRoute: Route | null;
  activeTab: TabName;
  tabs: TabStacks;
  ready: boolean;
  indexState: IndexState;
  indexCount: number;
  indexError: string | null;
  toasts: Toast[];
  updateInfo: UpdateInfo | null;
  updateChecking: boolean;
  updateError: string | null;
  initialize: () => Promise<void>;
  checkForUpdates: (options?: { silent?: boolean }) => Promise<void>;
  dismissUpdate: () => Promise<void>;
  ensureCreatorIndex: (force?: boolean) => Promise<void>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  navigate: (route: Route) => void;
  switchTab: (tab: TabName) => void;
  back: (fallback?: Route) => void;
  forward: () => void;
  syncRouteFromLocation: () => void;
  toast: (kind: ToastKind, title: string, message?: string) => void;
  dismissToast: (id: string) => void;
  reportError: (error: unknown, title?: string) => void;
}

export type AppStoreSet = (
  partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>),
) => void;

export interface AppStoreApi {
  get: () => AppStore;
  set: AppStoreSet;
}
