import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../../../shared/api";
import { queryKeys } from "../../../shared/query/keys";
import { errorMessage } from "../../../shared/lib/constants";
import { useAppStore } from "../../../app/store";
import { SiteIcon } from "../../../shared/SiteIcon";
import { Button, Field, Spinner, TextInput, Toggle } from "../../../shared/ui";

export function AccountPanel() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const queryClient = useQueryClient();
  const toast = useAppStore((state) => state.toast);
  const reportError = useAppStore((state) => state.reportError);
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);

  const account = useQuery({
    queryKey: queryKeys.account(),
    queryFn: () => api.getAccountState(),
    staleTime: 30_000,
  });

  const login = useMutation({
    mutationFn: () => api.login(username.trim(), password, remember),
    onSuccess: (state) => {
      queryClient.setQueryData(["account"], state);
      setPassword("");
      toast("success", "Signed in", state.username ?? "Pawchive account");
      void queryClient.invalidateQueries({ queryKey: queryKeys.favoritesCreators() });
    },
    onError: (error) => reportError(error, "Could not sign in"),
  });

  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: (state) => {
      queryClient.setQueryData(["account"], state);
      toast("info", "Signed out");
    },
    onError: (error) => reportError(error, "Could not sign out"),
  });

  const syncFavorites = useMutation({
    mutationFn: () => api.syncAccountFavorites(),
    onSuccess: (count) => {
      toast(
        "success",
        "Favorites synced",
        `${count} creator${count === 1 ? "" : "s"} added to your local favorites.`,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.favoritesCreators() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.creators() });
    },
    onError: (error) => reportError(error, "Could not sync favorites"),
  });

  if (account.isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  if (account.isError) {
    return (
      <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/10 p-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-danger">
          <AlertCircle className="h-4 w-4" /> Could not load account status
        </p>
        <p className="text-[11px] leading-relaxed text-muted">
          {errorMessage(account.error)}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void account.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const state = account.data;
  const loggedIn = Boolean(state?.loggedIn);

  if (loggedIn) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-accent/12">
            <SiteIcon name="account" size={22} />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
              {state?.username}
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            </p>
            <p className="text-[11px] text-muted">Signed in with a session cookie</p>
          </div>
        </div>
        <Toggle
          checked={settings.autoSyncFavorites}
          onChange={(checked) =>
            void saveSettings({ autoSyncFavorites: checked })
          }
          label="Auto-sync favorite creators"
          description="Sync your Pawchive account favorites automatically when the app starts."
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={syncFavorites.isPending}
            onClick={() => syncFavorites.mutate()}
          >
            <RefreshCw className="h-4 w-4" /> Sync favorite creators
          </Button>
          <Button
            variant="ghost"
            loading={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-line/60 bg-surface/60 p-3 text-[10px] leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          Your password is sent only to Pawchive over HTTPS and is never stored.
          The session cookie stays in the Rust backend and is saved locally only
          when “Remember me” is enabled.
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (username.trim() && password) login.mutate();
      }}
    >
      <Field label="Username">
        <TextInput
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          maxLength={200}
        />
      </Field>
      <Field label="Password">
        <TextInput
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          maxLength={500}
        />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          className="h-4 w-4 rounded border-line bg-base accent-[#66d9ff]"
        />
        Remember me on this device
      </label>
      {login.isError ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {errorMessage(login.error)}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="primary"
        loading={login.isPending}
        disabled={!username.trim() || !password}
        className="w-full"
      >
        <SiteIcon name="login" size={16} tone="dark" /> Sign in
      </Button>
      <p className="text-[10px] leading-relaxed text-dim">
        Use the same username and password as the Pawchive website. This app
        does not support registration; create an account on pawchive.pw first.
      </p>
    </form>
  );
}
