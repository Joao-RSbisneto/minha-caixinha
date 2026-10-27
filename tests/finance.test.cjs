const { test } = require("node:test");
const assert = require("node:assert/strict");
const finance = require("../js/finance.js");
const base = () => ({
  goal: 50000,
  initialBalance: 100.1,
  names: ["Ana", "Bia"],
  setupComplete: true,
  tx: [],
});
const tx = (id, type, amount) => ({
  id,
  type,
  amount,
  date: "2026-10-27",
  person: 1,
  desc: "Economia",
});
test("totais separam abertura e depósitos sem erro de ponto flutuante", () => {
  const state = base();
  state.tx = [
    tx("a", "deposit", 0.1),
    tx("b", "deposit", 0.2),
    tx("c", "withdraw", 0.1),
  ];
  assert.deepEqual(finance.totals(state), {
    in: 0.3,
    out: 0.1,
    bal: 100.3,
    p1: 0.3,
    p2: 0,
  });
});
test("edição ou exclusão de depósito não pode deixar saldo negativo", () => {
  const state = base();
  state.initialBalance = 0;
  state.tx = [tx("withdraw", "withdraw", 10)];
  assert.throws(() => finance.validateState(state), /negativo/);
});
test("datas inexistentes, valores fracionários e duplicatas são rejeitados", () => {
  for (const date of ["2026-02-30", "2026-13-01", ""])
    assert.equal(finance.validDate(date), false);
  assert.equal(finance.validDate("2024-02-29"), true);
  assert.equal(finance.validAmount(1.001), false);
  assert.equal(finance.validAmount(Infinity), false);
  const state = base();
  state.tx = [tx("same", "deposit", 1), tx("same", "deposit", 1)];
  assert.throws(() => finance.validateState(state), /movimentação/);
});
test("CSV inclui abertura, quebras reais e valores assinados", () => {
  const state = base();
  state.tx = [tx("a", "deposit", 10), tx("b", "withdraw", 5)];
  const csv = finance.csv(state);
  assert.ok(csv.startsWith("\ufeff"));
  assert.equal(csv.split("\r\n").length, 4);
  assert.match(csv, /Saldo inicial/);
  assert.match(csv, /"100,10"/);
  assert.match(csv, /"-5,00"/);
  assert.equal(finance.totals(state).bal, 105.1);
});
test("CSV neutraliza fórmulas de texto e preserva aspas", () => {
  const state = base();
  state.names[0] = '=HYPERLINK("x")';
  state.tx = [{ ...tx("a", "deposit", 1), desc: "@SUM(1)" }];
  const csv = finance.csv(state);
  assert.ok(csv.includes("'@SUM(1)"));
  assert.ok(csv.includes("'=HYPERLINK("));
  assert.ok(csv.includes('""x""'));
});
