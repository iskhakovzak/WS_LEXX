import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";
import { ReasonDialog, type ReasonDialogState } from "./ReasonDialog";
import { ROLE_LABEL, adminUrl, errorFrom, postJson } from "./api";

export const BAN_PRESETS = ["Спам в обсуждениях", "Оскорбления", "Нарушение риск-правил", "Ушёл из команды"];

type Target = { id: number; name: string; role: string };

/**
 * Ban / unban / role / password actions with a reason dialog, shared by the traders table,
 * the trader sheet and the overview. Render `dialog` once in the owning component.
 */
export function useUserActions(actor: string, onChange?: () => void) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [state, setState] = useState<ReasonDialogState>(null);

  const invalidate = () => {
    for (const k of ["admin-users", "admin-overview", "admin-audit", "admin-desk-pulse", "admin-reports"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
    onChange?.();
  };
  const onError = (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" });

  const banMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      postJson<{ name?: string }>(adminUrl(`/admin/users/${id}/ban`, actor), { actor, reason }, "Не удалось забанить"),
    onSuccess: (u) => { invalidate(); setState(null); toast({ title: `${u?.name ?? "Пользователь"} забанен`, description: "Сессии завершены." }); },
    onError,
  });
  const unbanMut = useMutation({
    mutationFn: ({ id }: { id: number; reason: string }) =>
      postJson<{ name?: string }>(adminUrl(`/admin/users/${id}/unban`, actor), { actor }, "Не удалось разбанить"),
    onSuccess: (u) => { invalidate(); setState(null); toast({ title: `${u?.name ?? "Пользователь"} разбанен` }); },
    onError,
  });
  const roleMut = useMutation({
    mutationFn: async ({ id, role, reason }: { id: number; role: string; reason: string }) => {
      // New audited route (curators may switch trader <-> curator; admin role needs users.manage.admins).
      const r = await fetch(`${BASE}/api/admin/console/people/${id}/role`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, reason }),
      });
      const ct = r.headers.get("content-type") ?? "";
      if (r.status === 404 && !ct.includes("json")) {
        // API not rebuilt yet: legacy route (admins only).
        return postJson<{ name?: string; role?: string }>(adminUrl(`/admin/users/${id}/role`, actor), { actor, role }, "Не удалось сменить роль");
      }
      if (!r.ok) throw await errorFrom(r, "Не удалось сменить роль");
      return r.json() as Promise<{ name?: string; role?: string }>;
    },
    onSuccess: (u) => {
      invalidate();
      setState(null);
      toast({ title: "Роль обновлена", description: u?.name ? `${u.name} → ${ROLE_LABEL[u.role ?? ""] ?? u.role}` : undefined });
    },
    onError,
  });
  const passwordMut = useMutation({
    mutationFn: async ({ id, password }: { id: number; name: string; password: string }) => {
      const r = await fetch(`${BASE}/api/users/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) throw await errorFrom(r, "Не удалось сменить пароль");
      return r.json();
    },
    onSuccess: (_d, v) => { setState(null); toast({ title: `Пароль для ${v.name} обновлён`, description: "Активные сессии пользователя завершены." }); },
    onError,
  });

  const busy = banMut.isPending || unbanMut.isPending || roleMut.isPending || passwordMut.isPending;

  return {
    busy,
    dialog: <ReasonDialog state={state} onClose={() => setState(null)} busy={busy} />,
    ban: (u: Target) => setState({
      title: `Забанить ${u.name}?`,
      description: "Пользователь будет разлогинен и не сможет войти до разбана. Действие попадёт в журнал аудита.",
      confirmLabel: "Забанить",
      destructive: true,
      input: { label: "Причина", kind: "textarea", required: true, presets: BAN_PRESETS, placeholder: "Что произошло" },
      onConfirm: (reason) => banMut.mutate({ id: u.id, reason }),
    }),
    unban: (u: Target) => setState({
      title: `Разбанить ${u.name}?`,
      description: "Пользователь снова сможет войти. Разбан попадёт в журнал аудита.",
      confirmLabel: "Разбанить",
      onConfirm: (reason) => unbanMut.mutate({ id: u.id, reason }),
    }),
    changeRole: (u: Target, role: string) => setState({
      title: `Сменить роль ${u.name}?`,
      description: `${ROLE_LABEL[u.role] ?? u.role} → ${ROLE_LABEL[role] ?? role}. Пользователю нужно будет войти заново.`,
      confirmLabel: "Сменить роль",
      input: { label: "Причина (попадёт в аудит)", kind: "textarea", required: true, minLength: 3, presets: ["Повышение", "Изменение обязанностей"], placeholder: "Коротко: почему" },
      onConfirm: (reason) => roleMut.mutate({ id: u.id, role, reason }),
    }),
    setPassword: (u: Target) => setState({
      title: `Новый пароль для ${u.name}`,
      description: "Все активные сессии пользователя будут завершены.",
      confirmLabel: "Сохранить пароль",
      input: { label: "Новый пароль", kind: "password", minLength: 4, required: true, placeholder: "Минимум 4 символа" },
      onConfirm: (password) => passwordMut.mutate({ id: u.id, name: u.name, password }),
    }),
  };
}
