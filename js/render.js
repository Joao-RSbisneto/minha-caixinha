function render() {
  const t = totals(),
    bal = t.bal,
    goal = Number(state.goal) || 1,
    p = Math.max(0, Math.min(100, (bal / goal) * 100));
  $("balance").textContent = money(bal);
  $("openingBalanceNote").classList.toggle(
    "hidden",
    !(Number(state.initialBalance) > 0),
  );
  $("openingBalanceText").textContent = money(state.initialBalance || 0);
  $("deposited").textContent = money(t.in);
  $("withdrawn").textContent = money(t.out);
  $("goalLabel").textContent = money(goal);
  $("percent").textContent = Math.round(p) + "%";
  $("progress").style.width = p + "%";
  $("savedLabel").textContent = money(bal) + " guardados";
  $("remainingLabel").textContent =
    bal >= goal
      ? "Meta alcançada! 🎉"
      : "Faltam " + money(Math.max(0, goal - bal));
  $("total1").textContent = money(t.p1);
  $("total2").textContent = money(t.p2);
  $("name1").textContent = state.names[0];
  $("name2").textContent = state.names[1];
  $("avatar1").textContent = (state.names[0][0] || "V").toUpperCase();
  $("avatar2").textContent = (state.names[1][0] || "A").toUpperCase();
  let dates = state.tx
    .filter((x) => x.type === "deposit")
    .map((x) => x.date)
    .sort();
  const days = dates.length
    ? Math.max(
        1,
        Math.floor((new Date(today()) - new Date(dates[0])) / 86400000) + 1,
      )
    : 0;
  $("days").textContent = days + (days === 1 ? " dia" : " dias");
  let filter = $("filter").value,
    arr = [...state.tx]
      .filter((x) => filter === "all" || x.type === filter)
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  let el = $("transactions");
  if (!arr.length) {
    el.innerHTML =
      '<div class="empty">Ainda não há movimentações.<br>Registrem o primeiro depósito para começar! 🌱</div>';
    return;
  }
  el.innerHTML = arr
    .map(
      (x) =>
        `<div class="transaction"><div class="txicon ${x.type === "deposit" ? "deposit" : "withdraw"}">${x.type === "deposit" ? "↙" : "↗"}</div><div class="txbody"><strong>${safe(x.desc)}</strong><span>${safe(state.names[x.person - 1])} · ${new Date(x.date + "T12:00:00").toLocaleDateString("pt-BR")}</span></div><div class="amount ${x.type === "deposit" ? "plus" : "minus"}">${x.type === "deposit" ? "+" : "−"} ${money(x.amount)}</div><div class="txactions"><button class="btn outline" type="button" data-edit="${safe(x.id)}" aria-label="Editar ${safe(x.desc)}">Editar</button><button class="btn outline danger" type="button" data-delete="${safe(x.id)}" aria-label="Excluir ${safe(x.desc)}">Excluir</button></div></div>`,
    )
    .join("");
}

function historyDetails(data) {
  if (!data) return "—";
  if (data.type) {
    return [
      data.type === "deposit" ? "Depósito" : "Retirada",
      money(data.amount),
      new Date(data.date + "T12:00:00").toLocaleDateString("pt-BR"),
      state.names[data.person - 1],
      data.desc,
    ]
      .map(safe)
      .join(" · ");
  }
  return [
    "Meta: " + money(data.goal),
    "Saldo inicial: " + money(data.initialBalance),
    "Nomes: " + (data.names || []).join(" e "),
    data.setupComplete ? "Caixinha configurada" : "Configuração pendente",
  ]
    .map(safe)
    .join(" · ");
}
