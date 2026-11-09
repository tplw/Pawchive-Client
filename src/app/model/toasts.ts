import { errorMessage } from "../../shared/lib/constants";
import type { AppStore, AppStoreApi, ToastKind } from "./types";

let toastCounter = 0;
const MAX_VISIBLE_TOASTS = 3;

export function createToastActions({
  get,
  set,
}: AppStoreApi): Pick<AppStore, "toast" | "dismissToast" | "reportError"> {
  return {
    toast: (kind: ToastKind, title: string, message?: string) => {
      const id = `toast-${++toastCounter}`;
      set((state) => ({
        toasts: [...state.toasts, { id, kind, title, message }].slice(
          -MAX_VISIBLE_TOASTS,
        ),
      }));

      window.setTimeout(
        () => get().dismissToast(id),
        kind === "error" ? 7000 : 4200,
      );
    },

    dismissToast: (id) =>
      set((state) => ({
        toasts: state.toasts.filter((toast) => toast.id !== id),
      })),

    reportError: (error, title = "Something went wrong") => {
      get().toast("error", title, errorMessage(error));
    },
  };
}
