(function (root) {
  "use strict";
  const MAX_AMOUNT = 9999999999.99;
  const cents = (value) => Math.round(Number(value) * 100);
  const money = (value) =>
    Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const date = new Date(value + "T12:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }
  function validAmount(value, allowZero = false) {
    return (
      Number.isFinite(value) &&
      value >= (allowZero ? 0 : 0.01) &&
      value <= MAX_AMOUNT &&
      Math.abs(value * 100 - Math.round(value * 100)) < 0.0001
    );
  }
  function totals(state) {
    let deposited = 0,
      withdrawn = 0,
      p1 = 0,
      p2 = 0;
    for (const tx of state.tx) {
      const amount = cents(tx.amount);
      if (tx.type === "deposit") {
        deposited += amount;
        if (tx.person === 1) p1 += amount;
        else p2 += amount;
      } else withdrawn += amount;
    }
    return {
      in: deposited / 100,
      out: withdrawn / 100,
      bal: (cents(state.initialBalance) + deposited - withdrawn) / 100,
      p1: p1 / 100,
      p2: p2 / 100,
    };
  }
  function validateState(state) {
    if (!state || typeof state !== "object")
      throw new Error("Dados da caixinha inválidos.");
    if (state.openingDate !== undefined && !validDate(state.openingDate))
      throw new Error("Data de abertura inválida.");
    if (!validAmount(state.goal) || !validAmount(state.initialBalance, true))
      throw new Error("Informe valores válidos, com até duas casas decimais.");
    if (
      !Array.isArray(state.names) ||
      state.names.length !== 2 ||
      state.names.some(
        (n) => typeof n !== "string" || !n.trim() || n.length > 35,
      )
    )
      throw new Error("Preencha os dois nomes (até 35 caracteres).");
    if (typeof state.setupComplete !== "boolean" || !Array.isArray(state.tx))
      throw new Error("Dados da caixinha inválidos.");
    const ids = new Set();
    for (const tx of state.tx) {
      if (
        typeof tx.id !== "string" ||
        !tx.id ||
        tx.id.length > 100 ||
        ids.has(tx.id) ||
        !["deposit", "withdraw"].includes(tx.type) ||
        ![1, 2].includes(tx.person) ||
        !validAmount(tx.amount) ||
        !validDate(tx.date) ||
        typeof tx.desc !== "string" ||
        !tx.desc.trim() ||
        tx.desc.length > 100
      )
        throw new Error(
          "Confira o valor, a data, a descrição e o responsável da movimentação.",
        );
      ids.add(tx.id);
    }
    if (totals(state).bal < 0)
      throw new Error("Essa alteração deixaria o saldo negativo.");
    return state;
  }
  function csvCell(value) {
    let text = String(value ?? "");
    // Aspas não impedem que planilhas interpretem texto como fórmula.
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csv(state) {
    const rows = [["Data", "Tipo", "Responsável", "Descrição", "Valor (R$)"]];
    rows.push([
      state.openingDate || "",
      "Saldo inicial",
      "",
      "Saldo de abertura",
      state.initialBalance.toFixed(2).replace(".", ","),
    ]);
    for (const tx of [...state.tx].sort((a, b) =>
      a.date.localeCompare(b.date),
    )) {
      rows.push([
        tx.date,
        tx.type === "deposit" ? "Depósito" : "Retirada",
        state.names[tx.person - 1],
        tx.desc,
        (tx.type === "deposit" ? tx.amount : -tx.amount)
          .toFixed(2)
          .replace(".", ","),
      ]);
    }
    return (
      "\ufeff" +
      rows
        .map((row) =>
          row
            .map((value, index) =>
              index === 4 && /^-?\d+,\d{2}$/.test(String(value))
                ? '"' + value + '"'
                : csvCell(value),
            )
            .join(";"),
        )
        .join("\r\n")
    );
  }
  const api = {
    cents,
    money,
    today,
    validDate,
    validAmount,
    totals,
    validateState,
    csv,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.Caixinha = api;
})(typeof window !== "undefined" ? window : globalThis);
