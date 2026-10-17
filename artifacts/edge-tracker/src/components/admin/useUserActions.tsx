import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ApiError, http } from "@/lib/api/http";
import { ReasonDialog, type ReasonDialogState } from "./ReasonDialog";
import { ROLE_LABEL, adminUrl } from "./api";
import { secretMinFor } from "@/lib/secret-policy";
import { authI18n } from "@/i18n/ns/auth";

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
      http.post<{ name?: string }>(adminUrl(`/admin/users/${id}/ban`, actor), { actor, reason }),
    onSuccess: (u) => { invalidate(); setState(null); toast({ title: `${u?.name ?? "Пользователь"} забанен`, description: "Сессии завершены." }); },
    onError,
  });
  const unbanMut = useMutation({
    mutationFn: ({ id }: { id: number; reason: string }) =>
      http.post<{ name?: string }>(adminUrl(`/admin/users/${id}/unban`, actor), { actor }),
    onSuccess: (u) => { invalidate(); setState(null); toast({ title: `${u?.name ?? "Пользователь"} разбанен` }); },
    onError,
  });
  const roleMut = useMutation({
    mutationFn: async ({ id, role, reason }: { id: number; role: string; reason: string }) => {
      // New audited route (curators may switch trader <-> curator; admin role needs users.manage.admins).
      try {
        return await http.post<{ name?: string; role?: string }>(`/api/admin/console/people/${id}/role`, { role, reason });
      } catch (e) {
        // API not rebuilt yet (route-missing 404: no `code`): legacy route (admins only).
        if (e instanceof ApiError && e.status === 404 && !e.code) {
          return http.post<{ name?: string; role?: string }>(adminUrl(`/admin/users/${id}/role`, actor), { actor, role });
        }
        throw e;
      }
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
      return http.patch(`/api/users/${id}`, { password });
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
      input: { label: "Новый пароль", kind: "password", minLength: secretMinFor(u.role), required: true, placeholder: authI18n.t("forced.tooShort", { min: secretMinFor(u.role) }) },
      onConfirm: (password) => passwordMut.mutate({ id: u.id, name: u.name, password }),
    }),
  };
}
