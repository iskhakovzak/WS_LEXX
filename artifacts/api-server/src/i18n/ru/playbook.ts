/** Server `playbook`: playbook quick-add suggestion reasons — lib/playbookInbox.ts, routes/playbook-spaces.ts. Setup names and trade labels are user content. */
export default {
  suggest: {
    linked: "Сделка уже привязана к сетапу",
    linkedHere: "Сделка привязана к этому сетапу",
    auto: "Автоклассификация: {label}",
    text: "Название похоже на метку сделки «{label}»",
    strategy: "Стратегия «{label}», вход в {time} NY — окно этого сетапа",
    time: "Вход в {time} NY — окно этого сетапа",
  },
} as const;
