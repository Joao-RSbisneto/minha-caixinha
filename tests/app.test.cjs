const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const finance = require("../js/finance.js");
function app(configured = true, recovery = false, sessionRequest = null) {
  const elements = new Map(),
    events = {};
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      const button = { disabled: false };
      elements.set(id, {
        value: id === "filter" ? "all" : "",
        textContent: "",
        style: {},
        disabled: false,
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
          toggle(name, yes) {
            if (yes) classes.add(name);
            else classes.delete(name);
          },
        },
        querySelector: () => button,
        querySelectorAll: () => [],
        reset() {},
        reportValidity: () => true,
        focus() {},
      });
    }
    return elements.get(id);
  };
  let result = {
    data: {
      payload: finance.validateState({
        goal: 50000,
        initialBalance: 0,
        names: ["A", "B"],
        setupComplete: true,
        tx: [],
      }),
      updated_at: "v2",
    },
    error: null,
  };
  let authError = null,
    callback,
    recoveryRequests = 0,
    writes = 0;
  const client = {
    channel() {
      const channel = {
        on() {
          return channel;
        },
        subscribe() {
          return channel;
        },
      };
      return channel;
    },
    auth: {
      getSession: () =>
        sessionRequest || Promise.resolve({ data: { session: null } }),
      onAuthStateChange: (fn) => (callback = fn),
      signInWithPassword: async () => ({
        error: authError,
        data: { user: { id: "user", email: "a@b.com" } },
      }),
      resetPasswordForEmail: async () => {
        recoveryRequests++;
        return { error: authError };
      },
      resend: async () => ({ error: authError }),
      updateUser: async () => ({ error: authError }),
    },
    rpc: async () => {
      writes++;
      return typeof result === "function" ? result() : result;
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              payload: {
                goal: 50000,
                initialBalance: 0,
                names: ["A", "B"],
                setupComplete: true,
                tx: [],
              },
              updated_at: "v3",
            },
          }),
        }),
      }),
    }),
  };
  const context = vm.createContext({
    window: {
      Caixinha: finance,
      ...(configured
        ? {
            NOSSA_CAIXINHA_CONFIG: {
              url: "https://example.supabase.co",
              anonKey: "public-key",
            },
            supabase: { createClient: () => client },
          }
        : {}),
      location: {
        pathname: "/",
        origin: "http://localhost:5500",
        hash: recovery ? "#type=recovery" : "",
        search: "",
      },
      history: { replaceState() {} },
      addEventListener() {},
    },
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: (name, fn) => (events[name] = fn),
      body: {
        setAttribute() {},
        removeAttribute() {},
        classList: { add() {}, remove() {} },
      },
    },
    setTimeout: () => 0,
    clearTimeout() {},
    console,
    URL,
    URLSearchParams,
    crypto: { randomUUID: () => "new-id" },
    confirm: () => true,
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/render.js"), "utf8"),
    context,
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8"),
    context,
  );
  return {
    element,
    run: (code) => vm.runInContext(code, context),
    setResult: (value) => (result = value),
    setError: (error) => (authError = error),
    event: (value) => callback(value),
    counts: () => ({ writes, recoveryRequests }),
  };
}
test("configuração ausente bloqueia autenticação e explica como configurar", async () => {
  const a = app(false);
  await a.run("authenticate({preventDefault(){}},false)");
  assert.match(a.element("loginError").textContent, /Configure/);
  assert.equal(a.counts().writes, 0);
});
test("gravação confirmada atualiza estado e revisão", async () => {
  const a = app();
  a.run("currentUser={id:'user'};state=defaultState();revision='v1'");
  assert.equal(await a.run("save({...state,goal:100})"), true);
  assert.equal(a.run("revision"), "v2");
});
test("falha de gravação preserva estado confirmado e não anuncia sucesso", async () => {
  const a = app();
  a.run("currentUser={id:'user'};state=defaultState();revision='v1'");
  a.setResult({ data: null, error: { message: "offline" } });
  assert.equal(await a.run("save({...state,goal:100})"), false);
  assert.equal(a.run("state.goal"), 50000);
  assert.equal(a.run("revision"), "v1");
  assert.match(a.element("toast").textContent, /offline/);
});
test("conflito recarrega dados antes de nova tentativa", async () => {
  const a = app();
  a.run("currentUser={id:'user'};state=defaultState();revision='v1'");
  a.setResult({ data: null, error: { code: "40001" } });
  assert.equal(await a.run("save({...state,goal:100})"), false);
  assert.equal(a.run("revision"), "v3");
  assert.match(a.element("toast").textContent, /outro aparelho/);
});
test("ausência da função de banco orienta migração", async () => {
  const a = app();
  a.run("currentUser={id:'user'};state=defaultState()");
  a.setResult({ error: { code: "PGRST202" } });
  assert.equal(await a.run("save(state)"), false);
  assert.match(a.element("toast").textContent, /002-ledger.sql/);
});
test("envio duplicado é bloqueado enquanto aguarda banco", async () => {
  const a = app();
  a.run("currentUser={id:'user'};state=defaultState()");
  let finish;
  a.setResult(() => new Promise((resolve) => (finish = resolve)));
  const pending = a.run("save(state)");
  assert.equal(await a.run("save(state)"), false);
  assert.equal(a.counts().writes, 1);
  finish({
    data: {
      payload: {
        goal: 50000,
        initialBalance: 0,
        names: ["A", "B"],
        setupComplete: true,
        tx: [],
      },
      updated_at: "v2",
    },
  });
  await pending;
});
test("link de recuperação abre formulário dedicado", async () => {
  const a = app();
  a.event("PASSWORD_RECOVERY");
  assert.equal(a.element("recoveryCard").classList.contains("hidden"), false);
  assert.equal(a.element("authCard").classList.contains("hidden"), true);
  assert.equal(a.run("recoveryMode"), true);
});
test("recuperação de senha respeita espera entre solicitações", async () => {
  const a = app();
  a.element("loginEmail").value = "user@example.com";
  await a.run("requestEmail()");
  await a.run("requestEmail()");
  assert.equal(a.counts().recoveryRequests, 1);
  assert.match(a.element("confirmationStatus").textContent, /Aguarde/);
});
test("erros de autenticação têm mensagens úteis", async () => {
  const a = app();
  a.setError({ code: "email_not_confirmed" });
  await a.run("authenticate({preventDefault(){}},false)");
  assert.match(a.element("loginError").textContent, /Confirme seu e-mail/);
  assert.match(a.run("authErrorMessage({status:429})"), /limitou/);
});

test("inicialização mantém login oculto enquanto restaura sessão", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const a = app(true, false, pending);
  assert.equal(a.element("authScreen").classList.contains("hidden"), true);
  assert.equal(a.element("loadingScreen").classList.contains("hidden"), false);
  finish({
    data: { session: { user: { id: "user", email: "test@example.com" } } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.element("authScreen").classList.contains("hidden"), true);
  assert.equal(a.element("loadingScreen").classList.contains("hidden"), true);
  assert.equal(a.element("appScreen").classList.contains("hidden"), false);
});

test("sem sessão mostra login após concluir verificação", async () => {
  const a = app();
  assert.equal(a.element("authScreen").classList.contains("hidden"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.element("authScreen").classList.contains("hidden"), false);
  assert.equal(a.element("loadingScreen").classList.contains("hidden"), true);
});

test("falha na sessão sai do carregamento e mostra erro", async () => {
  const a = app(
    true,
    false,
    Promise.resolve({ error: { message: "Sem conexão" } }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.element("loadingScreen").classList.contains("hidden"), true);
  assert.equal(a.element("authScreen").classList.contains("hidden"), false);
  assert.match(a.element("loginError").textContent, /Sem conexão/);
});

test("HTML inicial oculta o login antes de executar JavaScript", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /id="authScreen" class="hidden"/);
  assert.match(html, /id="loadingScreen"/);
});
