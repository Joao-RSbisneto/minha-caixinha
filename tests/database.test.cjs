const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const fs = require("node:fs");
const path = require("node:path");
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const payload = () => ({
  goal: 50000,
  initialBalance: 100,
  names: ["Pessoa A", "Pessoa B"],
  setupComplete: true,
  tx: [
    {
      id: "legacy-123",
      type: "deposit",
      amount: 20.25,
      person: 1,
      date: "2026-10-27",
      desc: "Primeiro depósito",
    },
  ],
});

test("migração, validações, concorrência e isolamento no PostgreSQL", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create publication supabase_realtime;
    insert into auth.users values ('${userA}'), ('${userB}');`);
  await db.exec(
    fs.readFileSync(path.join(__dirname, "../supabase-schema.sql"), "utf8"),
  );
  await db.query(
    "insert into public.couple_data(user_id,payload) values ($1,$2)",
    [userA, JSON.stringify(payload())],
  );
  const migration = fs.readFileSync(
    path.join(__dirname, "../migrations/002-ledger.sql"),
    "utf8",
  );
  await db.exec(migration);
  await t.test("preserva e normaliza registros existentes", async () => {
    const result = await db.query(
      "select amount::text,description from caixinha_transactions",
    );
    assert.equal(result.rows[0].amount, "20.25");
    assert.equal(
      (await db.query("select payload from couple_data")).rows[0].payload.tx[0]
        .id,
      "legacy-123",
    );
  });
  await t.test(
    "migração pode ser repetida sem duplicar histórico",
    async () => {
      const count = (
        await db.query("select count(*)::int as n from caixinha_audit")
      ).rows[0].n;
      await db.exec(migration);
      assert.equal(
        (await db.query("select count(*)::int as n from caixinha_audit"))
          .rows[0].n,
        count,
      );
    },
  );
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`,
  );
  const revision = async () =>
    (await db.query("select updated_at::text as revision from couple_data"))
      .rows[0].revision;
  const save = async (data, rev) =>
    (
      await db.query(
        "select public.save_caixinha($1::jsonb,$2::timestamptz) as result",
        [JSON.stringify(data), rev],
      )
    ).rows[0].result;
  await t.test(
    "atualiza movimentação e mantém antes/depois no histórico",
    async () => {
      const next = payload();
      next.tx[0].amount = 30;
      await save(next, await revision());
      assert.equal(
        (await db.query("select amount::text from caixinha_transactions"))
          .rows[0].amount,
        "30.00",
      );
      const audit = (
        await db.query(
          "select before_data,after_data from caixinha_audit where action='UPDATE'",
        )
      ).rows[0];
      assert.equal(audit.before_data.amount, 20.25);
      assert.equal(audit.after_data.amount, 30);
    },
  );
  await t.test("rejeita revisão antiga", async () => {
    await assert.rejects(
      save(payload(), "2000-01-01T00:00:00Z"),
      (error) => error.code === "40001",
    );
  });
  await t.test(
    "valida valores, datas, responsáveis e identificadores",
    async () => {
      for (const change of [
        (tx) => (tx.amount = -1),
        (tx) => (tx.amount = 1.001),
        (tx) => (tx.date = "2026-02-30"),
        (tx) => (tx.person = 3),
        (tx) => (tx.desc = "   "),
        (tx) => (tx.type = "other"),
      ]) {
        const next = payload();
        change(next.tx[0]);
        await assert.rejects(save(next, await revision()));
      }
      const duplicate = payload();
      duplicate.tx.push({ ...duplicate.tx[0] });
      await assert.rejects(save(duplicate, await revision()));
      assert.equal(
        (await db.query("select amount::text from caixinha_transactions"))
          .rows[0].amount,
        "30.00",
      );
    },
  );
  await t.test("saldo negativo desfaz toda gravação e auditoria", async () => {
    const before = (
      await db.query("select count(*)::int as n from caixinha_audit")
    ).rows[0].n;
    const next = payload();
    next.tx[0].type = "withdraw";
    next.tx[0].amount = 200;
    await assert.rejects(
      save(next, await revision()),
      (error) => error.code === "23514",
    );
    assert.equal(
      (await db.query("select count(*)::int as n from caixinha_audit")).rows[0]
        .n,
      before,
    );
  });
  await t.test("exclusão preserva o histórico", async () => {
    const next = payload();
    next.tx = [];
    await save(next, await revision());
    assert.equal(
      (await db.query("select * from caixinha_transactions")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from caixinha_audit where action='DELETE'"))
        .rows.length,
      1,
    );
  });
  await t.test(
    "cliente não pode editar dados ou auditoria diretamente",
    async () => {
      await assert.rejects(
        db.query("update couple_data set payload='{}'"),
        (error) => error.code === "42501",
      );
      await assert.rejects(
        db.query("delete from caixinha_audit"),
        (error) => error.code === "42501",
      );
      await assert.rejects(
        db.query("delete from caixinha_transactions"),
        (error) => error.code === "42501",
      );
    },
  );
  await t.test("conta B não lê dados ou histórico da conta A", async () => {
    await db.exec(
      `select set_config('request.jwt.claim.sub','${userB}',false);`,
    );
    assert.equal((await db.query("select * from couple_data")).rows.length, 0);
    assert.equal(
      (await db.query("select * from caixinha_audit")).rows.length,
      0,
    );
    await save(payload(), null);
    assert.equal(
      (await db.query("select user_id from couple_data")).rows[0].user_id,
      userB,
    );
    assert.ok(
      (await db.query("select user_id from caixinha_transactions")).rows.every(
        (row) => row.user_id === userB,
      ),
    );
    await assert.rejects(
      save(payload(), null),
      (error) => error.code === "40001",
    );
  });
  await t.test("acesso sem autenticação é negado", async () => {
    await db.exec(
      "reset role; set role anon; select set_config('request.jwt.claim.sub','',false);",
    );
    await assert.rejects(
      db.query("select * from couple_data"),
      (error) => error.code === "42501",
    );
    await assert.rejects(
      save(payload(), null),
      (error) => error.code === "42501",
    );
  });
  await t.test("repetir SQL inicial não reabre escrita direta", async () => {
    await db.exec("reset role");
    await db.exec(
      fs.readFileSync(path.join(__dirname, "../supabase-schema.sql"), "utf8"),
    );
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`,
    );
    await assert.rejects(
      db.query("update couple_data set payload='{}'"),
      (error) => error.code === "42501",
    );
  });
});
