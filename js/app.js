"use strict";

const $ = (id) => document.getElementById(id);
const config = window.NOSSA_CAIXINHA_CONFIG || {};
const CLOUD_ENABLED = !!(
  window.supabase &&
  /^https:\/\//.test(config.url || "") &&
  config.anonKey &&
  !/COLE_/.test(config.url + config.anonKey)
);
const supabaseClient = CLOUD_ENABLED
  ? window.supabase.createClient(config.url, config.anonKey)
  : null;
const { money, today } = window.Caixinha;
const safe = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state = null,
  currentUser = null,
  revision = null,
  saving = false,
  realtimeChannel = null;
let editingId = null,
  recoveryMode = false,
  refreshPending = false,
  previousFocus = null;
let passwordRetryAt = 0;
const totals = () => window.Caixinha.totals(state);
const defaultState = () => ({
  goal: 50000,
  names: ["Marido", "Esposa"],
  initialBalance: 0,
  setupComplete: false,
  tx: [],
});

function setError(id, message) {
  $(id).textContent = message;
  $(id).style.display = message ? "block" : "none";
}
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.add("show");
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 7000);
}
function syncStatus(message, error = false) {
  $("syncStatus").textContent = message;
  $("syncStatus").classList.toggle("danger", error);
}
function switchAuth(mode) {
  $("loginForm").classList.toggle("active", mode === "login");
  $("registerForm").classList.toggle("active", mode === "register");
  $("loginTab").classList.toggle("active", mode === "login");
  $("registerTab").classList.toggle("active", mode === "register");
}
function showAuth(mode = "login") {
  $("loadingScreen").classList.add("hidden");
  $("authScreen").classList.remove("hidden");
  $("appScreen").classList.add("hidden");
  $("authCard").classList.remove("hidden");
  $("setupCard").classList.add("hidden");
  $("recoveryCard").classList.add("hidden");
  switchAuth(mode);
}
function showSetup() {
  showAuth();
  $("authCard").classList.add("hidden");
  $("setupCard").classList.remove("hidden");
}
function showRecovery() {
  recoveryMode = true;
  showAuth();
  $("authCard").classList.add("hidden");
  $("recoveryCard").classList.remove("hidden");
  $("newPassword").focus();
}
async function loadCloud() {
  const owner = currentUser?.id;
  if (!owner) return;
  const { data, error } = await supabaseClient
    .from("couple_data")
    .select("payload,updated_at")
    .eq("user_id", owner)
    .maybeSingle();
  if (error) throw error;
  if (currentUser?.id !== owner) return;
  const next = data?.payload || defaultState();
  window.Caixinha.validateState(next);
  state = next;
  revision = data?.updated_at || null;
}
function enterApp() {
  $("loadingScreen").classList.add("hidden");
  $("authScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");
  render();
  startRealtime();
}
async function openSession(user) {
  currentUser = { email: user.email, id: user.id };
  await loadCloud();
  if (recoveryMode) return;
  if (state.setupComplete) enterApp();
  else showSetup();
}
async function refresh() {
  if (saving) {
    refreshPending = true;
    return;
  }
  if (!currentUser || recoveryMode) return;
  try {
    await loadCloud();
    if (state.setupComplete) render();
    else showSetup();
    syncStatus("Dados atualizados");
  } catch {
    syncStatus("Não foi possível atualizar. Confira sua conexão.", true);
  }
}
function startRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabaseClient
    .channel("caixinha-" + currentUser.id)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "couple_data",
        filter: "user_id=eq." + currentUser.id,
      },
      () => {
        void refresh();
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        syncStatus("Conectado");
        void refresh();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status))
        syncStatus(
          "Sincronização indisponível. Atualize a página para conferir os dados.",
          true,
        );
    });
}
async function save(next) {
  if (saving || !currentUser?.id) return false;
  try {
    window.Caixinha.validateState(next);
  } catch (error) {
    toast(error.message);
    return false;
  }
  saving = true;
  syncStatus("Salvando…");
  const buttons = [...document.querySelectorAll("button")].map((button) => [
    button,
    button.disabled,
  ]);
  buttons.forEach(([button]) => (button.disabled = true));
  document.body.setAttribute("aria-busy", "true");
  try {
    const { data, error } = await supabaseClient.rpc("save_caixinha", {
      p_payload: next,
      p_expected_revision: revision,
    });
    if (error) throw error;
    state = data.payload;
    revision = data.updated_at;
    render();
    syncStatus("Salvo agora");
    return true;
  } catch (error) {
    if (error.code === "40001") {
      await refreshAfterConflict();
      toast(
        "A caixinha mudou em outro aparelho. Confira os dados atualizados e tente novamente.",
      );
    } else if (error.code === "PGRST202" || error.code === "42883") {
      toast(
        "O banco precisa ser atualizado. Execute migrations/002-ledger.sql no SQL Editor do Supabase.",
      );
    } else toast("Não foi possível salvar: " + error.message);
    syncStatus(
      "Alteração não confirmada. Confira os dados antes de tentar novamente.",
      true,
    );
    return false;
  } finally {
    saving = false;
    document.body.removeAttribute("aria-busy");
    buttons.forEach(([button, disabled]) => (button.disabled = disabled));
    if (refreshPending) {
      refreshPending = false;
      void refresh();
    }
  }
}
async function refreshAfterConflict() {
  try {
    await loadCloud();
    render();
  } catch {
    syncStatus("Não foi possível recarregar os dados.", true);
  }
}
function openModal(id) {
  previousFocus = document.activeElement;
  $(id).classList.add("open");
  $("appScreen").inert = true;
  $("authScreen").inert = true;
  document.body.classList.add("modal-open");
  // Prioriza o campo de edição: o primeiro botão do diálogo é o de fechar.
  const initialField = $(id).querySelector('input:not([type="hidden"]),select');
  (initialField || $(id).querySelector("button"))?.focus();
}
function close(id) {
  if (saving) return;
  $(id).classList.remove("open");
  if (!document.querySelector(".modalback.open")) {
    document.body.classList.remove("modal-open");
    $("appScreen").inert = false;
    $("authScreen").inert = false;
  }
  previousFocus?.focus();
}
function openTx(type, tx = null) {
  editingId = tx?.id || null;
  $("txType").value = type;
  $("modalTitle").textContent = tx
    ? "Editar movimentação"
    : type === "deposit"
      ? "Registrar depósito"
      : "Registrar retirada";
  $("txAmount").value = tx?.amount ?? "";
  $("txDesc").value = tx?.desc || "";
  $("txDate").value = tx?.date || today();
  $("txPerson").innerHTML = state.names
    .map((name, i) => `<option value="${i + 1}">${safe(name)}</option>`)
    .join("");
  $("txPerson").value = String(tx?.person || 1);
  openModal("modalback");
}
function authErrorMessage(error) {
  if (error.code === "email_not_confirmed")
    return "Confirme seu e-mail para entrar. Verifique sua caixa de entrada ou entre em contato com o administrador.";
  if (error.code === "invalid_credentials")
    return "E-mail ou senha incorretos.";
  if (
    error.status === 429 ||
    ["over_email_send_rate_limit", "over_request_rate_limit"].includes(
      error.code,
    )
  )
    return "O Supabase limitou temporariamente as tentativas ou os envios de e-mail. Aguarde a liberação do limite antes de tentar novamente.";
  return "Não foi possível continuar: " + error.message;
}
async function authenticate(event, register) {
  event.preventDefault();
  const prefix = register ? "register" : "login",
    form = $(prefix + "Form"),
    button = form.querySelector('button[type="submit"]');
  setError(prefix + "Error", "");
  if (!CLOUD_ENABLED) {
    setError(
      prefix + "Error",
      "Configure a URL e a chave pública do Supabase.",
    );
    return;
  }
  if (button.disabled) return;
  const email = $(prefix + "Email")
      .value.trim()
      .toLowerCase(),
    password = $(prefix + "Password").value;
  if (register && password !== $("registerConfirm").value) {
    setError("registerError", "As senhas não coincidem.");
    return;
  }
  button.disabled = true;
  try {
    const { data, error } = register
      ? await supabaseClient.auth.signUp({ email, password })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    form.reset();
    if (register && !data.session) {
      setError(
        "registerError",
        "Cadastro criado! Confirme seu e-mail e depois entre.",
      );
      return;
    }
    await openSession(data.user);
  } catch (error) {
    setError(prefix + "Error", authErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}
async function requestEmail() {
  const button = $("forgotPassword"),
    status = $("confirmationStatus"),
    input = $("loginEmail");
  if (!CLOUD_ENABLED) {
    status.textContent = "Configure o Supabase para continuar.";
    return;
  }
  if (button.disabled || !input.reportValidity()) return;
  if (Date.now() < passwordRetryAt) {
    status.textContent =
      "Aguarde um minuto antes de solicitar outro e-mail. O limite do Supabase pode exigir uma espera maior.";
    return;
  }
  button.disabled = true;
  passwordRetryAt = Date.now() + 60000;
  status.textContent = "Solicitando e-mail…";
  try {
    const redirectTo = new URL(window.location.pathname, window.location.origin)
      .href;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(
      input.value.trim().toLowerCase(),
      { redirectTo },
    );
    if (error) throw error;
    status.textContent =
      "Solicitação aceita. Se houver uma conta elegível, você receberá um e-mail. Confira também o spam e use o link mais recente.";
  } catch (error) {
    status.textContent = authErrorMessage(error);
  } finally {
    button.disabled = false;
  }
}
function clearSession() {
  if (realtimeChannel) {
    void supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  currentUser = null;
  state = null;
  revision = null;
  recoveryMode = false;
  document
    .querySelectorAll(".modalback")
    .forEach((modal) => modal.classList.remove("open"));
  document.body.classList.remove("modal-open");
  $("appScreen").inert = false;
  $("authScreen").inert = false;
  ["loginForm", "registerForm", "passwordForm"].forEach((id) => $(id).reset());
  showAuth();
}

$("loginTab").onclick = () => switchAuth("login");
$("registerTab").onclick = () => switchAuth("register");
$("loginForm").onsubmit = (event) => authenticate(event, false);
$("registerForm").onsubmit = (event) => authenticate(event, true);
$("forgotPassword").onclick = () => requestEmail();
$("passwordForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("passwordForm").querySelector('button[type="submit"]');
  if (button.disabled || !recoveryMode) return;
  const password = $("newPassword").value;
  if (password.length < 8 || password !== $("confirmPassword").value) {
    setError(
      "passwordError",
      "Use pelo menos 8 caracteres e confirme a mesma senha.",
    );
    return;
  }
  button.disabled = true;
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    recoveryMode = false;
    $("passwordForm").reset();
    const { data, error: sessionError } =
      await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    if (data.session) await openSession(data.session.user);
    else showAuth();
    toast("Senha atualizada com sucesso!");
  } catch (error) {
    setError("passwordError", authErrorMessage(error));
  } finally {
    button.disabled = false;
  }
};
$("cancelRecovery").onclick = async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (error) toast(authErrorMessage(error));
  else clearSession();
};
$("logoutBtn").onclick = async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (error) toast(authErrorMessage(error));
  else clearSession();
};
$("setupForm").onsubmit = async (event) => {
  event.preventDefault();
  const next = {
    ...defaultState(),
    names: [$("husbandName").value.trim(), $("wifeName").value.trim()],
    initialBalance: Number($("initialBalance").value),
    goal: Number($("initialGoal").value),
    setupComplete: true,
    openingDate: today(),
  };
  if (await save(next)) {
    enterApp();
    toast("Caixinha criada com sucesso!");
  }
};
$("addDeposit").onclick = () => openTx("deposit");
$("addWithdraw").onclick = () => openTx("withdraw");
$("closeModal").onclick = () => close("modalback");
$("txForm").onsubmit = async (event) => {
  event.preventDefault();
  if (saving) return;
  const tx = {
    id: editingId || crypto.randomUUID(),
    type: $("txType").value,
    amount: Number($("txAmount").value),
    person: Number($("txPerson").value),
    date: $("txDate").value,
    desc: $("txDesc").value.trim(),
  };
  if (editingId && !state.tx.some((item) => item.id === editingId)) {
    toast("Essa movimentação foi excluída em outro aparelho.");
    return;
  }
  const next = {
    ...state,
    tx: editingId
      ? state.tx.map((item) => (item.id === editingId ? tx : item))
      : [...state.tx, tx],
  };
  if (await save(next)) {
    close("modalback");
    toast(editingId ? "Movimentação atualizada!" : "Movimentação registrada!");
  }
};
$("transactions").onclick = async (event) => {
  const button = event.target.closest("button[data-edit],button[data-delete]");
  if (!button || saving) return;
  const id = button.dataset.edit || button.dataset.delete,
    tx = state.tx.find((item) => item.id === id);
  if (!tx) return;
  if (button.dataset.edit) openTx(tx.type, tx);
  else if (
    confirm(
      "Excluir esta movimentação? A alteração ficará registrada no histórico.",
    )
  ) {
    if (await save({ ...state, tx: state.tx.filter((item) => item.id !== id) }))
      toast("Movimentação excluída.");
  }
};
$("editGoal").onclick = () => {
  $("goalAmount").value = state.goal;
  openModal("goalback");
};
$("closeGoal").onclick = () => close("goalback");
$("goalForm").onsubmit = async (event) => {
  event.preventDefault();
  if (await save({ ...state, goal: Number($("goalAmount").value) })) {
    close("goalback");
    toast("Meta atualizada!");
  }
};
$("editNames").onclick = () => {
  $("person1").value = state.names[0];
  $("person2").value = state.names[1];
  openModal("namesback");
};
$("closeNames").onclick = () => close("namesback");
$("namesForm").onsubmit = async (event) => {
  event.preventDefault();
  if (
    await save({
      ...state,
      names: [$("person1").value.trim(), $("person2").value.trim()],
    })
  ) {
    close("namesback");
    toast("Nomes atualizados!");
  }
};
$("filter").onchange = render;
$("export").onclick = () => {
  const href = URL.createObjectURL(
    new Blob([window.Caixinha.csv(state)], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = href;
  link.download = "extrato-nossa-caixinha.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
};
$("reset").onclick = async () => {
  if (
    saving ||
    !confirm(
      "Redefinir esta caixinha no banco online e em todos os aparelhos? Exporte o extrato antes. O histórico de alterações será preservado.",
    )
  )
    return;
  if (await save(defaultState())) {
    showSetup();
    toast("Caixinha redefinida.");
  }
};
$("showHistory").onclick = async () => {
  openModal("historyback");
  $("historyList").textContent = "Carregando…";
  try {
    const { data, error } = await supabaseClient
      .from("caixinha_audit")
      .select("action,before_data,after_data,created_at")
      .eq("user_id", currentUser.id)
      .order("id", { ascending: false })
      .limit(100);
    if (error) throw error;
    const labels = {
      INSERT: "Inclusão",
      UPDATE: "Edição",
      DELETE: "Exclusão",
      SETTINGS: "Configurações",
    };
    $("historyList").innerHTML = data.length
      ? data
          .map(
            (row) =>
              `<div class="history-entry"><strong>${safe(labels[row.action] || "Alteração")}</strong> · ${safe(new Date(row.created_at).toLocaleString("pt-BR"))}<p><b>Antes:</b> ${historyDetails(row.before_data)}</p><p><b>Depois:</b> ${historyDetails(row.after_data)}</p></div>`,
          )
          .join("")
      : "Nenhuma alteração registrada.";
  } catch {
    $("historyList").textContent =
      "Não foi possível carregar o histórico. Confira a conexão e a migração do banco.";
  }
};
$("closeHistory").onclick = () => close("historyback");
document.querySelectorAll(".modalback").forEach((modal) =>
  modal.addEventListener("click", (event) => {
    // Formulários só fecham por uma ação explícita. Cliques no fundo,
    // inclusive ao terminar uma seleção de texto, preservam a edição.
    if (event.target === modal && modal.id === "historyback") close(modal.id);
  }),
);
document.addEventListener("keydown", (event) => {
  const modal = document.querySelector(".modalback.open");
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close(modal.id);
  }
  if (event.key === "Tab") {
    const controls = [
      ...modal.querySelectorAll(
        'button:not(:disabled),input:not([type="hidden"]):not(:disabled),select:not(:disabled),[tabindex="0"]',
      ),
    ];
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
window.addEventListener("online", () => {
  void refresh();
});
window.addEventListener("offline", () =>
  syncStatus("Sem conexão. Aguarde para registrar alterações.", true),
);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
$("year").textContent = new Date().getFullYear();
async function boot() {
  $("loadingScreen").classList.remove("hidden");
  $("authScreen").classList.add("hidden");
  $("appScreen").classList.add("hidden");
  if (!CLOUD_ENABLED) {
    showAuth();
    setError(
      "loginError",
      "Configure js/supabase-config.js com a URL e a chave pública do Supabase.",
    );
    return;
  }
  const callback = new URLSearchParams(window.location.hash.slice(1));
  if (callback.get("type") === "recovery") recoveryMode = true;
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") showRecovery();
    if (event === "SIGNED_OUT") clearSession();
    if (
      event === "SIGNED_IN" &&
      currentUser &&
      session?.user.id !== currentUser.id
    ) {
      clearSession();
      setTimeout(() => {
        void openSession(session.user).catch((error) =>
          setError("loginError", authErrorMessage(error)),
        );
      }, 0);
    }
  });
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (callback.has("error")) {
      recoveryMode = false;
      showAuth();
      setError(
        "loginError",
        "O link é inválido ou expirou. Solicite um novo e-mail.",
      );
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    } else if (data.session) {
      if (recoveryMode) showRecovery();
      else await openSession(data.session.user);
    } else if (recoveryMode) {
      recoveryMode = false;
      showAuth();
      setError(
        "loginError",
        "O link de recuperação expirou. Solicite outro em Esqueci minha senha.",
      );
    } else showAuth();
  } catch (error) {
    if (recoveryMode) {
      showRecovery();
      setError("passwordError", authErrorMessage(error));
    } else {
      showAuth();
      setError("loginError", authErrorMessage(error));
    }
  }
}
void boot();
