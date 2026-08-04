(function () {
  "use strict";

  // Tema escuro: aplica cor clara nos textos/eixos de TODOS os gráficos de
  // uma vez, sem precisar repetir em cada configuração individual.
  if (window.Chart) {
    Chart.defaults.color = "#8B909C";
    Chart.defaults.borderColor = "rgba(255,255,255,0.08)";
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  }

  const STORAGE_KEY = "fluxo_saida_config_v1";
  const els = {
    emptyState: document.getElementById("emptyState"),
    dashboard: document.getElementById("dashboard"),
    diretrizFilters: document.getElementById("diretrizFilters"),
    classifFilters: document.getElementById("classifFilters"),
    searchInput: document.getElementById("searchInput"),
    productsBody: document.getElementById("productsBody"),
    rowCount: document.getElementById("rowCount"),
    syncDot: document.getElementById("syncDot"),
    syncText: document.getElementById("syncText"),
    refreshBtn: document.getElementById("refreshBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsDialog: document.getElementById("settingsDialog"),
    settingsForm: document.getElementById("settingsForm"),
    cancelSettings: document.getElementById("cancelSettings"),
    emptyConnectBtn: document.getElementById("emptyConnectBtn"),
    apiUrl: document.getElementById("apiUrl"),
    apiToken: document.getElementById("apiToken"),
  };

  let state = {
    produtos: [],
    saida_diaria: [],
    saida_mensal: [],
    financeiro_diario: [],
    financeiro_mensal: [],
    curva_abc: [],
    transacoes: [],
    financeiroView: "mensal",
    mesFinanceiro: null,
    contaFinanceiro: "ambas",
    periodoView: "dia",
    transModo: "detalhado",
    sortKey: "Últimos 30 dias",
    sortDir: "desc",
    search: "",
    diretrizFiltro: new Set(),
    classifFiltro: new Set(),
  };

  let dailyChart, monthlyChart, financeiroChart;

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return window.DEFAULT_CONFIG || { apiUrl: "", apiToken: "" };
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function diretrizClass(diretriz) {
    const d = (diretriz || "").toUpperCase();
    if (d.includes("FOCO")) return "foco";
    if (d.includes("MANUTEN")) return "manutencao";
    if (d.includes("DESPRIORIZ")) return "despriorizado";
    if (d.includes("SAÍDA") || d.includes("SAIDA")) return "saida";
    return "ignorar";
  }

  function badge(text, kind) {
    const cls = kind === "classif" ? text : diretrizClass(text);
    return `<span class="badge badge--${cls}">${escapeHtml(text ?? "-")}</span>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtNum(n) {
    if (n === null || n === undefined || n === "") return "-";
    return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }
  function fmtPct(n) {
    if (n === null || n === undefined || n === "") return "-";
    return (Number(n) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || n === "") return "-";
    return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }

  // ---------------------------------------------------------------- fetch
  async function fetchData() {
    const cfg = loadConfig();
    if (!cfg.apiUrl || !cfg.apiToken) {
      showEmpty();
      return;
    }
    setSyncStatus("carregando", null);
    try {
      const url = cfg.apiUrl + (cfg.apiUrl.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(cfg.apiToken);
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      state.produtos = data.produtos || [];
      state.saida_diaria = data.saida_diaria || [];
      state.saida_mensal = data.saida_mensal || [];
      state.financeiro_diario = data.financeiro_diario || [];
      state.financeiro_mensal = data.financeiro_mensal || [];      state.curva_abc = data.curva_abc || [];
      state.transacoes = data.transacoes || [];
      state.transacoes_2 = data.transacoes_2 || [];
      state.devolucoes = data.devolucoes || [];
      state.devolucoes_2 = data.devolucoes_2 || [];

      // Junta o Faturamento/Lucro em R$ (da Curva ABC) em cada produto,
      // pra mostrar valor real ao lado da nota A/B/C.
      const abcBySku = {};
      state.curva_abc.forEach((c) => { abcBySku[c["SKU"]] = c; });
      state.produtos.forEach((p) => {
        const c = abcBySku[p["SKUs"]];
        p["_fat_rs"] = c ? Number(c["Faturamento 12M"] || 0) : 0;
        p["_lucro_rs"] = c ? Number(c["Lucro 12M"] || 0) : 0;
        p["_margem"] = p["_fat_rs"] ? p["_lucro_rs"] / p["_fat_rs"] : 0;
      });

      setSyncStatus("ok", data.gerado_em);
      render();
    } catch (err) {
      console.error(err);
      setSyncStatus("erro", null);
    }
  }

  function setSyncStatus(status, geradoEm) {
    els.syncDot.className = "sync-dot" + (status === "ok" ? " ok" : status === "erro" ? " err" : "");
    if (status === "ok") {
      const d = geradoEm ? new Date(geradoEm) : new Date();
      els.syncText.textContent = "atualizado " + d.toLocaleTimeString("pt-BR") + " · auto";
    } else if (status === "erro") {
      els.syncText.textContent = "erro ao conectar — confira URL/token";
    } else {
      els.syncText.textContent = "carregando…";
    }
  }

  function showEmpty() {
    els.emptyState.classList.remove("hidden");
    els.dashboard.classList.add("hidden");
  }
  function showDashboard() {
    els.emptyState.classList.add("hidden");
    els.dashboard.classList.remove("hidden");
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!state.produtos.length) { showEmpty(); return; }
    showDashboard();
    renderHero();
    renderAcoesHoje();
    renderMeta();
    renderAbc();
    renderTendencia();
    renderRuptura();
    renderTodosPeriodoPickers_();
    renderEstoque();
    renderFinanceiro();
    renderFilters();
    renderTable();
    renderCharts();
    renderTransacoes();
    renderComparativo();
  }

  function popularSelectsComparativo_() {
    const meses = state.financeiro_mensal;
    const selA = document.getElementById("mesASelect"), selB = document.getElementById("mesBSelect");
    if (!meses.length) return;

    // Antes, as opções usavam o ÍNDICE do array como valor e só eram
    // geradas 1x (guardadas por "quantidade de meses", que fica sempre em
    // 12). Como "Financeiro Mensal" é uma janela ROLANTE de 12 meses, com
    // o tempo o mês que estava no índice 0 sai e outro entra — mas as
    // opções antigas continuavam com o mesmo texto e valor de antes, então
    // o rótulo mostrado (ex: "jun/25") não era mais o mês que o índice
    // selecionado de fato apontava. Agora a chave é a DATA do período
    // (estável, não muda de significado com o tempo) e as opções são
    // sempre recriadas, preservando a seleção atual quando ela ainda existir.
    const valorAtualA = selA.value, valorAtualB = selB.value;
    const opts = meses.map((m) => `<option value="${m.periodo}">${fmtMesLabel_(m.periodo)}</option>`).join("");
    selA.innerHTML = opts;
    selB.innerHTML = opts;

    const existeA = meses.some((m) => m.periodo === valorAtualA);
    const existeB = meses.some((m) => m.periodo === valorAtualB);
    selA.value = existeA ? valorAtualA : meses[Math.max(0, meses.length - 2)].periodo;
    selB.value = existeB ? valorAtualB : meses[meses.length - 1].periodo;
  }

  const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  function fmtMesLabel_(iso) {
    const d = new Date(iso);
    return `${MESES_ABREV[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
  }

  document.getElementById("mesASelect").addEventListener("change", renderComparativo);
  document.getElementById("mesBSelect").addEventListener("change", renderComparativo);

  function renderComparativo() {
    popularSelectsComparativo_();
    const meses = state.financeiro_mensal;
    if (!meses.length) return;
    const valA = document.getElementById("mesASelect").value;
    const valB = document.getElementById("mesBSelect").value;
    const mesA = meses.find((m) => m.periodo === valA);
    const mesB = meses.find((m) => m.periodo === valB);
    if (!mesA || !mesB) return;

    document.getElementById("mesALabel").textContent = fmtMesLabel_(mesA.periodo);
    document.getElementById("mesBLabel").textContent = fmtMesLabel_(mesB.periodo);

    const linhas = [
      { label: "Faturamento", a: mesA.faturamento, b: mesB.faturamento, tipo: "money" },
      { label: "Custo (produto)", a: mesA.custo, b: mesB.custo, tipo: "money" },
      { label: "Taxa ML", a: mesA.taxa_ml, b: mesB.taxa_ml, tipo: "money" },
      { label: "Frete", a: mesA.frete, b: mesB.frete, tipo: "money" },
      { label: "Gasto Ads", a: mesA.gasto_ads, b: mesB.gasto_ads, tipo: "money" },
      { label: "Lucro Líquido", a: mesA.lucro_liquido, b: mesB.lucro_liquido, tipo: "money" },
      { label: "Margem", a: mesA.margem, b: mesB.margem, tipo: "pct" },
    ];

    document.getElementById("comparativoBody").innerHTML = linhas.map((l) => {
      const fmt = l.tipo === "money" ? fmtMoney : fmtPct;
      const variacao = l.a ? ((l.b - l.a) / Math.abs(l.a)) * 100 : (l.b ? 100 : 0);
      const cls = variacao > 0.5 ? "up" : variacao < -0.5 ? "down" : "";
      const seta = variacao > 0.5 ? "▲" : variacao < -0.5 ? "▼" : "•";
      return `<tr>
        <td>${l.label}</td>
        <td class="num">${fmt(l.a)}</td>
        <td class="num">${fmt(l.b)}</td>
        <td class="num ${cls}">${seta} ${Math.abs(variacao).toFixed(0)}%</td>
      </tr>`;
    }).join("");
  }

  function isoDate_(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Cada painel de "vendas por produto com filtro de data" (o de sempre,
  // dentro de Produtos, e o novo, dentro de Hoje) usa o mesmo motor —
  // só muda o conjunto de IDs e o preset inicial.
  const PERIODO_PICKERS = [
    { presetsId: "periodoPresets", deId: "dataDe", ateId: "dataAte", resumoId: "periodoResumo", bodyId: "diaBody", presetInicial: "ontem" },
    { presetsId: "hojePeriodoPresets", deId: "hojeDataDe", ateId: "hojeDataAte", resumoId: "hojePeriodoResumo", bodyId: "hojeDiaBody", presetInicial: "hoje" },
  ];

  function aplicarPresetPeriodo_(cfg, preset) {
    const hoje = new Date();
    const de = document.getElementById(cfg.deId), ate = document.getElementById(cfg.ateId);
    if (preset === "hoje") { de.value = isoDate_(hoje); ate.value = isoDate_(hoje); }
    if (preset === "ontem") {
      const o = new Date(hoje); o.setDate(o.getDate() - 1);
      de.value = isoDate_(o); ate.value = isoDate_(o);
    }
    if (preset === "7dias") {
      const seteAtras = new Date(hoje); seteAtras.setDate(seteAtras.getDate() - 6);
      de.value = isoDate_(seteAtras); ate.value = isoDate_(hoje);
    }
    if (preset === "mes") {
      de.value = isoDate_(new Date(hoje.getFullYear(), hoje.getMonth(), 1)); ate.value = isoDate_(hoje);
    }
    document.querySelectorAll(`#${cfg.presetsId} .preset-btn`).forEach((b) => b.classList.toggle("active", b.dataset.preset === preset));
  }

  function initPeriodoPickers_() {
    PERIODO_PICKERS.forEach((cfg) => {
      aplicarPresetPeriodo_(cfg, cfg.presetInicial);

      document.getElementById(cfg.presetsId).addEventListener("click", (e) => {
        const btn = e.target.closest(".preset-btn");
        if (!btn) return;
        aplicarPresetPeriodo_(cfg, btn.dataset.preset);
        renderVendasPorProduto_(cfg);
      });
      document.getElementById(cfg.deId).addEventListener("change", () => {
        document.querySelectorAll(`#${cfg.presetsId} .preset-btn`).forEach((b) => b.classList.remove("active"));
        renderVendasPorProduto_(cfg);
      });
      document.getElementById(cfg.ateId).addEventListener("change", () => {
        document.querySelectorAll(`#${cfg.presetsId} .preset-btn`).forEach((b) => b.classList.remove("active"));
        renderVendasPorProduto_(cfg);
      });
    });
  }

  function renderTodosPeriodoPickers_() {
    PERIODO_PICKERS.forEach((cfg) => renderVendasPorProduto_(cfg));
  }

  function renderVendasPorProduto_(cfg) {
    const de = document.getElementById(cfg.deId).value;
    const ate = document.getElementById(cfg.ateId).value;
    if (!de || !ate) return;

    const fotoPorSku = {}, linkPorSku = {}, fornecedorPorSku = {};
    state.produtos.forEach((p) => {
      fotoPorSku[p["SKUs"]] = p["Foto URL"];
      linkPorSku[p["SKUs"]] = p["Link Anúncio"];
      fornecedorPorSku[p["SKUs"]] = p["Fornecedor"];
    });

    const noPeriodo = state.transacoes.filter((t) => {
      const d = (t.data || "").slice(0, 10);
      return d >= de && d <= ate;
    });

    const grupos = {};
    noPeriodo.forEach((t) => {
      if (!grupos[t.sku]) grupos[t.sku] = { sku: t.sku, fornecedor: fornecedorPorSku[t.sku], qtd: 0, faturamento: 0 };
      grupos[t.sku].qtd += Number(t.quantidade) || 0;
      grupos[t.sku].faturamento += Number(t.faturamento) || 0;
    });
    const linhas = Object.values(grupos).sort((a, b) => b.faturamento - a.faturamento);

    const totalQtd = linhas.reduce((s, l) => s + l.qtd, 0);
    const totalFat = linhas.reduce((s, l) => s + l.faturamento, 0);
    document.getElementById(cfg.resumoId).innerHTML = `
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtNum(totalQtd)}</span>
        <span class="fin-kpi__label">Unidades vendidas no período</span>
      </div>
      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">${fmtMoney(totalFat)}</span>
        <span class="fin-kpi__label">Faturamento no período</span>
      </div>`;

    const body = document.getElementById(cfg.bodyId);
    if (!linhas.length) {
      body.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:16px;">Nenhuma venda nesse período.</td></tr>`;
      return;
    }
    body.innerHTML = linhas.map((l) => `
      <tr>
        <td>${fmtFoto(fotoPorSku[l.sku])}</td>
        <td>${fmtSkuLink(l.sku, linkPorSku[l.sku])}</td>
        <td>${escapeHtml(l.fornecedor ?? "-")}</td>
        <td class="num">${fmtNum(l.qtd)}</td>
        <td class="num">${fmtMoney(l.faturamento)}</td>
      </tr>`).join("");
  }

  function renderEstoque() {
    const somenteSemCusto = document.getElementById("semCustoFiltro").checked;
    let totalParado = 0, totalPotencial = 0, totalLucroPotencial = 0;
    let linhas = state.produtos.map((p) => {
      const estoque = Number(p["Estoque AnyMarket disponível"] || 0);
      const custo = Number(p["Custo Unitário"] || 0);
      const preco = Number(p["Preço Atual"] || 0);
      // Antes usava a margem histórica de 12 meses (Lucro 12M / Faturamento
      // 12M) pra estimar o lucro potencial do estoque parado. Isso dava
      // valores sem sentido em produtos com pouco histórico de venda: um
      // SKU com 1-2 vendas e um frete caro naquele pedido específico podia
      // ter margem histórica de -300% ou +250%, e multiplicado pelo valor
      // de todo o estoque parado, o "lucro potencial" saía completamente
      // fora da realidade. Agora usa a margem simples e sempre coerente
      // entre o preço de venda ATUAL e o custo ATUAL do produto — não
      // depende de quantas vendas ele já teve.
      const margem = preco > 0 ? (preco - custo) / preco : 0;
      const valorParado = estoque * custo;
      const valorPotencial = estoque * preco;
      const lucroPotencial = valorPotencial * margem;
      totalParado += valorParado;
      totalPotencial += valorPotencial;
      totalLucroPotencial += lucroPotencial;
      return { sku: p["SKUs"], foto: p["Foto URL"], link: p["Link Anúncio"], estoque, custo, valorParado, preco, margem, lucroPotencial };
    }).sort((a, b) => b.valorParado - a.valorParado);

    document.getElementById("estoqueKpiRow").innerHTML = `
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(totalParado)}</span>
        <span class="fin-kpi__label">Capital parado em estoque (custo)</span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(totalPotencial)}</span>
        <span class="fin-kpi__label">Valor de venda potencial</span>
      </div>
      <div class="fin-kpi fin-kpi--profit">
        <span class="fin-kpi__value">${fmtMoney(totalLucroPotencial)}</span>
        <span class="fin-kpi__label">Lucro potencial (na margem atual)</span>
      </div>`;

    if (somenteSemCusto) linhas = linhas.filter((l) => !l.custo);

    document.getElementById("estoqueBody").innerHTML = linhas.map((l) => `
      <tr>
        <td>${fmtFoto(l.foto)}</td>
        <td>${fmtSkuLink(l.sku, l.link)}</td>
        <td class="num">${fmtNum(l.estoque)}</td>
        <td class="num">
          <input type="number" step="0.01" min="0" class="custo-edit" data-sku="${escapeHtml(l.sku)}" value="${l.custo || ""}" placeholder="0,00">
          <span class="custo-save-msg" data-sku-msg="${escapeHtml(l.sku)}"></span>
        </td>
        <td class="num">${fmtMoney(l.valorParado)}</td>
        <td class="num">${fmtMoney(l.preco)}</td>
        <td class="num">${fmtPct(l.margem)}</td>
        <td class="num">${fmtMoney(l.lucroPotencial)}</td>
      </tr>`).join("");

    document.querySelectorAll(".custo-edit").forEach((input) => {
      input.addEventListener("change", () => salvarCusto_(input));
    });
  }

  document.getElementById("semCustoFiltro").addEventListener("change", renderEstoque);

  async function salvarCusto_(input) {
    const sku = input.dataset.sku;
    const custo = Number(input.value || 0);
    const msg = document.querySelector(`[data-sku-msg="${sku}"]`);
    const cfg = loadConfig();
    input.classList.add("salvando");
    msg.textContent = "";
    msg.className = "custo-save-msg";
    try {
      const resp = await fetch(cfg.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: cfg.apiToken, acao: "atualizar_custo", sku, custo }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "erro");
      msg.textContent = "✓ salvo";
      msg.className = "custo-save-msg ok";
      // Atualiza o valor localmente pra Capital Parado/Margem já refletirem sem esperar o próximo fetch automático.
      const produto = state.produtos.find((p) => p["SKUs"] === sku);
      if (produto) produto["Custo Unitário"] = custo;
      renderEstoque();
    } catch (err) {
      msg.textContent = "✗ erro ao salvar";
      msg.className = "custo-save-msg erro";
    } finally {
      input.classList.remove("salvando");
    }
  }

  function renderAbc() {
    const total = state.curva_abc.reduce((s, c) => s + Number(c["Faturamento 12M"] || 0), 0);
    const grupos = { A: [], B: [], C: [] };
    state.curva_abc.forEach((c) => {
      const g = c["Grade Faturamento"];
      if (grupos[g]) grupos[g].push(c);
    });
    document.getElementById("abcRow").innerHTML = ["A", "B", "C"].map((letra) => {
      const lista = grupos[letra];
      const soma = lista.reduce((s, c) => s + Number(c["Faturamento 12M"] || 0), 0);
      const pct = total ? (soma / total) * 100 : 0;
      return `
        <div class="abc-card abc-card--${letra}">
          <div class="abc-card__letter">Curva ${letra}</div>
          <div class="abc-card__count">${lista.length} produto(s)</div>
          <div class="abc-card__pct">${pct.toFixed(1)}%</div>
          <div class="abc-card__pct-label">do faturamento (12M) · ${fmtMoney(soma)}</div>
        </div>`;
    }).join("");
  }

  function renderRuptura() {
    const tbody = document.getElementById("rupturaBody");
    const candidatos = state.produtos
      .filter((p) => {
        const dias = p["Dias até Ruptura"];
        return dias !== "-" && dias !== undefined && dias !== null && !p["Inativo"];
      })
      .sort((a, b) => Number(a["Dias até Ruptura"]) - Number(b["Dias até Ruptura"]))
      .slice(0, 12);

    if (!candidatos.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px;">Nenhum produto com venda recente para projetar.</td></tr>`;
      return;
    }

    tbody.innerHTML = candidatos.map((p) => {
      const dias = Number(p["Dias até Ruptura"]);
      const urgencia = dias <= 7 ? "saida" : dias <= 15 ? "despriorizado" : "manutencao";
      const previsao = p["Previsão de Ruptura"] ? new Date(p["Previsão de Ruptura"]).toLocaleDateString("pt-BR") : "-";
      const velocidadeDia = (Number(p["Últimos 15 dias"] || 0) / 15).toFixed(1);
      return `<tr>
        <td class="sku-cell">${escapeHtml(p["SKUs"])}</td>
        <td>${escapeHtml(p["Fornecedor"] ?? "-")}</td>
        <td class="num">${fmtNum(p["Estoque AnyMarket disponível"])}</td>
        <td class="num">${velocidadeDia}</td>
        <td class="num"><span class="badge badge--${urgencia}">${dias}d</span></td>
        <td>${previsao}</td>
      </tr>`;
    }).join("");
  }

  function renderFilters() {
    const diretrizes = [...new Set(state.produtos.map((p) => p["DIRETRIZ"]).filter(Boolean))];
    const classifs = [...new Set(state.produtos.map((p) => p["Classificação"]).filter(Boolean))];

    els.diretrizFilters.innerHTML = diretrizes.map((d) => chipHtml(d, state.diretrizFiltro.has(d))).join("");
    els.classifFilters.innerHTML = classifs.map((c) => chipHtml(c, state.classifFiltro.has(c))).join("");

    els.diretrizFilters.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        toggleSetValue(state.diretrizFiltro, chip.dataset.value);
        render();
      });
    });
    els.classifFilters.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        toggleSetValue(state.classifFiltro, chip.dataset.value);
        render();
      });
    });
  }

  function chipHtml(value, active) {
    return `<button type="button" class="chip ${active ? "active" : ""}" data-value="${escapeHtml(value)}"
      style="${active ? `background:var(--${diretrizClass(value)});` : ""}">${escapeHtml(value)}</button>`;
  }

  function toggleSetValue(set, val) {
    set.has(val) ? set.delete(val) : set.add(val);
  }

  function filteredSortedProducts() {
    const term = state.search.trim().toLowerCase();
    let rows = state.produtos.filter((p) => {
      if (term) {
        const hay = `${p["SKUs"] ?? ""} ${p["Fornecedor"] ?? ""} ${p["Categorias"] ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (state.diretrizFiltro.size && !state.diretrizFiltro.has(p["DIRETRIZ"])) return false;
      if (state.classifFiltro.size && !state.classifFiltro.has(p["Classificação"])) return false;
      return true;
    });
    rows.sort((a, b) => {
      const av = a[state.sortKey], bv = b[state.sortKey];
      const an = Number(av), bn = Number(bv);
      let cmp;
      if (!isNaN(an) && !isNaN(bn) && av !== "" && bv !== "") cmp = an - bn;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return state.sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }

  function fmtPrecoComPromo(precoOriginal, precoAtual) {
    const orig = Number(precoOriginal || 0);
    const atual = Number(precoAtual || 0);
    if (!atual) return "-";
    if (orig > atual + 0.005) {
      return `<span class="price-orig">${fmtMoney(orig)}</span><br><span class="price-promo">${fmtMoney(atual)}</span>`;
    }
    return `<span class="price-normal">${fmtMoney(atual)}</span>`;
  }

  function fmtRupturaBadge(dias) {
    if (dias === "-" || dias === undefined || dias === null || dias === "") {
      return `<span class="badge badge--ignorar">-</span>`;
    }
    const n = Number(dias);
    const urgencia = n <= 7 ? "saida" : n <= 15 ? "despriorizado" : "manutencao";
    return `<span class="badge badge--${urgencia}">${n}d</span>`;
  }

  function fmtSkuLink(sku, link) {
    const texto = escapeHtml(sku);
    return link
      ? `<a href="${link}" target="_blank" rel="noopener" class="sku-cell sku-link">${texto}</a>`
      : `<span class="sku-cell">${texto}</span>`;
  }

  function fmtFoto(url) {
    return url
      ? `<img src="${url}" class="produto-foto" loading="lazy" alt="" onerror="this.outerHTML='<span class=&quot;produto-foto produto-foto--vazia&quot;></span>'">`
      : `<span class="produto-foto produto-foto--vazia"></span>`;
  }

  // Selo minimalista mostrando de qual conta do Mercado Livre o produto
  // vem — "1", "2", ou as duas pontinhas juntas quando ele é vendido nas
  // duas. Quando tem link do anúncio da conta 2, o "2" já é clicável.
  function fmtContaBadge(contas, linkConta2) {
    if (!contas) return "";
    if (contas === "1 + 2") {
      return `<span class="conta-badge conta-badge--1">1</span>` +
        (linkConta2
          ? `<a href="${linkConta2}" target="_blank" rel="noopener" class="conta-badge conta-badge--2">2</a>`
          : `<span class="conta-badge conta-badge--2">2</span>`);
    }
    return `<span class="conta-badge conta-badge--${contas}">${contas}</span>`;
  }

  function renderTable() {
    const rows = filteredSortedProducts();
    els.rowCount.textContent = `(${rows.length})`;
    els.productsBody.innerHTML = rows.map((p, i) => `
      <tr class="data-row" data-idx="${i}">
        <td>${fmtFoto(p["Foto URL"])}</td>
        <td>${fmtSkuLink(p["SKUs"], p["Link Anúncio"])}</td>
        <td>${fmtContaBadge(p["Contas"], p["Link Anúncio Conta 2"])}</td>
        <td>${escapeHtml(p["Fornecedor"] ?? "-")}</td>
        <td>${escapeHtml(p["Categorias"] ?? "-")}</td>
        <td class="num">${fmtPrecoComPromo(p["Preço Original"], p["Preço Atual"])}</td>
        <td class="num">${fmtNum(p["Estoque AnyMarket disponível"])}</td>
        <td class="num">${fmtNum(p["Estoque WMS"])}</td>
        <td class="num">${fmtNum(p["Últimos 7 dias"])}</td>
        <td class="num">${fmtNum(p["Últimos 15 dias"])}</td>
        <td class="num">${fmtNum(p["Últimos 30 dias"])}</td>
        <td class="num">${fmtPct(p["Evolução últimos 30 dias"])}</td>
        <td class="num">${fmtMoney(p["_fat_rs"])}</td>
        <td class="num">${fmtMoney(p["_lucro_rs"])}</td>
        <td class="num">${fmtPct(p["_margem"])}</td>
        <td class="num">${fmtRupturaBadge(p["Dias até Ruptura"])}</td>
        <td>${badge(p["Classificação"], "classif")}</td>
        <td>${badge(p["DIRETRIZ"])}</td>
      </tr>`).join("");

    els.productsBody.querySelectorAll(".data-row").forEach((tr) => {
      tr.addEventListener("click", () => toggleRowDetail(tr, rows[Number(tr.dataset.idx)]));
    });
  }

  function toggleRowDetail(tr, product) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("row-detail")) { next.remove(); return; }
    document.querySelectorAll(".row-detail").forEach((n) => n.remove());

    const tpl = document.getElementById("rowDetailTemplate").content.cloneNode(true);
    tr.after(tpl);
    const detailRow = tr.nextElementSibling;
    const canvas = detailRow.querySelector("canvas");

    const serie = (state.saida_diaria.find((d) => d.sku === product["SKUs"]) || {}).serie || [];
    if (typeof Chart === "undefined") {
      canvas.insertAdjacentHTML("afterend", `<p class="chart-erro">⚠️ Biblioteca de gráficos não carregou — recarregue a página.</p>`);
      return;
    }
    new Chart(canvas, {
      type: "line",
      data: {
        labels: serie.map((s) => (s.periodo || "").slice(5)),
        datasets: [{
          data: serie.map((s) => s.quantidade),
          borderColor: "#5B9CFF", backgroundColor: "rgba(91,156,255,0.12)",
          fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, title: { display: true, text: `Saída diária — ${product["SKUs"]}`, font: { size: 11 } } },
        scales: { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } }, beginAtZero: true } },
      },
    });
  }

  // Se o Chart.js (carregado de um CDN externo) não terminar de carregar
  // (conexão lenta, bloqueador de anúncio, instabilidade do CDN), evita que
  // os gráficos fiquem vazios sem explicação — mostra um aviso e permite
  // tentar de novo, em vez de simplesmente falhar em silêncio.
  function chartJsDisponivel_(canvasId) {
    if (typeof Chart !== "undefined") return true;
    const canvas = document.getElementById(canvasId);
    if (canvas && canvas.parentElement && !canvas.parentElement.querySelector(".chart-erro")) {
      canvas.parentElement.insertAdjacentHTML("beforeend",
        `<p class="chart-erro">⚠️ Não foi possível carregar a biblioteca de gráficos (conexão lenta ou bloqueada). <button type="button" onclick="location.reload()" class="btn btn--ghost" style="margin-left:6px;">Recarregar página</button></p>`);
    }
    return false;
  }

  function renderCharts() {
    renderDailyChart();

    if (!chartJsDisponivel_("monthlyChart")) return;
    const monthlyTotals = aggregateSeries(state.saida_mensal);
    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(document.getElementById("monthlyChart"), {
      type: "bar",
      data: { labels: monthlyTotals.labels, datasets: [{ data: monthlyTotals.values, backgroundColor: "#3DDC97" }] },
      options: chartOptions(),
    });
  }

  function renderDailyChart() {
    if (!chartJsDisponivel_("dailyChart")) return;
    let labels, values;
    if (state.periodoView === "mes") {
      const m = aggregateSeries(state.saida_mensal);
      labels = m.labels; values = m.values;
    } else if (state.periodoView === "semana") {
      const w = aggregateSemanal_(state.saida_diaria);
      labels = w.labels; values = w.values;
    } else {
      const d = aggregateSeries(state.saida_diaria);
      labels = d.labels; values = d.values;
    }
    if (dailyChart) dailyChart.destroy();
    dailyChart = new Chart(document.getElementById("dailyChart"), {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: "#5B9CFF" }] },
      options: chartOptions(),
    });
  }

  // Agrupa a série diária (30 dias) em blocos de 7 dias (~4-5 semanas),
  // já que não existe uma aba "Semana" separada na planilha.
  function aggregateSemanal_(saidaDiaria) {
    if (!saidaDiaria.length) return { labels: [], values: [] };
    const nDias = saidaDiaria[0].serie.length;
    const totalPorDia = new Array(nDias).fill(0);
    saidaDiaria.forEach((item) => item.serie.forEach((s, i) => { totalPorDia[i] += Number(s.quantidade) || 0; }));

    const labels = [], values = [];
    for (let inicio = 0; inicio < nDias; inicio += 7) {
      const fim = Math.min(inicio + 7, nDias);
      const soma = totalPorDia.slice(inicio, fim).reduce((s, v) => s + v, 0);
      const dataInicio = (saidaDiaria[0].serie[inicio].periodo || "").slice(5);
      const dataFim = (saidaDiaria[0].serie[fim - 1].periodo || "").slice(5);
      labels.push(`${dataInicio}–${dataFim}`);
      values.push(soma);
    }
    return { labels, values };
  }

  function chartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { font: { size: 10 } } }, y: { beginAtZero: true, ticks: { font: { size: 10 } } } },
    };
  }

  function aggregateSeries(list) {
    if (!list.length) return { labels: [], values: [] };
    const nPeriods = list[0].serie.length;
    const labels = list[0].serie.map((s) => (s.periodo || "").slice(2));
    const values = new Array(nPeriods).fill(0);
    list.forEach((item) => item.serie.forEach((s, i) => { values[i] += Number(s.quantidade) || 0; }));
    return { labels, values };
  }

  // ------------------------------------------------------- financeiro por mês
  // Em vez de depender só da janela rolante fixa ("Financeiro Diário" = só
  // os últimos 30 dias, "Financeiro Mensal" = só os últimos 12 meses), o
  // financeiro agora é calculado direto de state.transacoes (o histórico
  // COMPLETO de RAW_Vendas, que já vem por venda), pra funcionar com
  // qualquer mês que você escolher — não só os que ainda estão dentro da
  // janela rolante da planilha.
  // Devolve a lista de transações da conta escolhida ("1", "2" ou "ambas").
  // Junta as duas listas quando "ambas" — como cada uma vem de uma aba
  // separada (RAW_Vendas / RAW_Vendas_2), não tem risco de duplicar nada.
  function transacoesPorConta_(conta) {
    if (conta === "1") return state.transacoes;
    if (conta === "2") return state.transacoes_2;
    return state.transacoes.concat(state.transacoes_2);
  }

  function transacoesDoMes_(yyyyMM, conta) {
    return transacoesPorConta_(conta || state.contaFinanceiro).filter((t) => (t.data || "").slice(0, 7) === yyyyMM);
  }

  function devolucoesPorConta_(conta) {
    if (conta === "1") return state.devolucoes;
    if (conta === "2") return state.devolucoes_2;
    return state.devolucoes.concat(state.devolucoes_2);
  }

  // Só conta como "Devolução" o produto que chegou a ser entregue e foi
  // revertido depois — "Cancelamento" (nunca entregue) não entra na taxa
  // de devolução, mas fica registrado do mesmo jeito em RAW_Cancelados.
  function devolucoesDoMes_(yyyyMM, conta) {
    return devolucoesPorConta_(conta || state.contaFinanceiro)
      .filter((d) => (d.data || "").slice(0, 7) === yyyyMM && d.tipo === "Devolução");
  }

  function totaisFinanceiroMes_(yyyyMM, conta) {
    const contaEfetiva = conta || state.contaFinanceiro;
    const txs = transacoesDoMes_(yyyyMM, contaEfetiva);
    const base = txs.reduce((acc, t) => ({
      faturamento: acc.faturamento + Number(t.faturamento || 0),
      custo: acc.custo + Number(t.custo || 0),
      taxa: acc.taxa + Number(t.taxa_ml || 0),
      frete: acc.frete + Number(t.frete || 0),
    }), { faturamento: 0, custo: 0, taxa: 0, frete: 0 });

    const pedidosPagos = new Set(txs.map((t) => t.pedido_id).filter(Boolean));
    const devolucoes = devolucoesDoMes_(yyyyMM, contaEfetiva);
    const pedidosDevolvidos = new Set(devolucoes.map((d) => d.pedido_id).filter(Boolean));
    const valorDevolvido = devolucoes.reduce((s, d) => s + Number(d.valor_reembolsado || 0), 0);
    // O pedido devolvido já saiu de RAW_Vendas (por isso não está em "txs"),
    // então pro total de pedidos pagos do mês precisamos somar os dois: os
    // que ainda estão contando como venda + os que foram pagos e depois
    // devolvidos. Sem isso, a taxa de devolução ficaria artificialmente alta.
    const totalPedidosNoMes = pedidosPagos.size + pedidosDevolvidos.size;
    const taxaDevolucao = totalPedidosNoMes ? pedidosDevolvidos.size / totalPedidosNoMes : 0;

    // "Gasto Ads" é digitado manualmente na planilha, pra CONTA 1 e sem
    // divisão por conta — só entra na conta quando a visão é "Ambas"
    // (que é o total real que ele representa). Olhando só a Conta 1 ou só
    // a Conta 2 isoladamente, não temos como saber qual fatia do Ads é de
    // qual conta, então não subtraímos (fica documentado no aviso).
    const mesInfo = state.financeiro_mensal.find((m) => (m.periodo || "").slice(0, 7) === yyyyMM);
    const ads = contaEfetiva === "ambas" && mesInfo ? Number(mesInfo.gasto_ads || 0) : 0;
    const semDadoAds = contaEfetiva === "ambas" ? !mesInfo : true;

    const lucro = base.faturamento - base.custo - base.taxa - base.frete - ads;
    return {
      ...base, ads, lucro, semDadoAds,
      numDevolucoes: pedidosDevolvidos.size, valorDevolvido, taxaDevolucao,
    };
  }

  // Série dia a dia de UM mês específico, sempre com todos os dias do mês
  // (mesmo os sem venda, com 0) — calculada das transações, não de uma
  // janela fixa, então funciona pra qualquer mês do histórico.
  function serieDiariaDoMes_(yyyyMM, conta) {
    const [ano, mes] = yyyyMM.split("-").map(Number);
    const diasNoMes = new Date(ano, mes, 0).getDate();
    const porDia = {};
    for (let d = 1; d <= diasNoMes; d++) {
      const chave = String(d).padStart(2, "0");
      porDia[chave] = { dia: chave, faturamento: 0, custo: 0, taxa: 0, frete: 0 };
    }
    transacoesDoMes_(yyyyMM, conta).forEach((t) => {
      const dia = (t.data || "").slice(8, 10);
      if (!porDia[dia]) return;
      porDia[dia].faturamento += Number(t.faturamento || 0);
      porDia[dia].custo += Number(t.custo || 0);
      porDia[dia].taxa += Number(t.taxa_ml || 0);
      porDia[dia].frete += Number(t.frete || 0);
    });
    // Ads diário só existe de verdade pros dias que ainda estão dentro da
    // janela rolante de 30 dias de "Financeiro Diário" (que é um número
    // combinado, não dividido por conta) — só faz sentido aplicar na visão
    // "Ambas"; olhando uma conta isolada, não sabemos a fatia certa, então
    // não entra na conta (mesma regra dos KPIs acima).
    const adsPorDia = {};
    if ((conta || state.contaFinanceiro) === "ambas") {
      state.financeiro_diario.forEach((d) => {
        const iso = (d.periodo || "").slice(0, 10);
        if (iso.slice(0, 7) === yyyyMM) adsPorDia[iso.slice(8, 10)] = Number(d.gasto_ads || 0);
      });
    }
    return Object.values(porDia).map((d) => {
      const ads = adsPorDia[d.dia] || 0;
      return {
        dia: d.dia,
        faturamento: d.faturamento,
        saidas: d.custo + d.taxa + d.frete + ads,
        lucro: d.faturamento - d.custo - d.taxa - d.frete - ads,
      };
    });
  }

  // Lista de meses (yyyy-MM) que existem no histórico de transações, do
  // mais recente pro mais antigo — sempre inclui o mês atual, mesmo sem
  // venda ainda, pra dar pra escolher "hoje" desde o primeiro dia do mês.
  function mesesDisponiveis_() {
    const set = new Set();
    state.transacoes.concat(state.transacoes_2).forEach((t) => {
      const m = (t.data || "").slice(0, 7);
      if (m) set.add(m);
    });
    const hoje = new Date();
    set.add(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`);
    return Array.from(set).sort().reverse();
  }

  function popularMesFinanceiroSelect_() {
    const sel = document.getElementById("financeiroMesSelect");
    const meses = mesesDisponiveis_();
    const opts = meses.map((m) => `<option value="${m}">${fmtMesLabel_(m + "-01")}</option>`).join("");
    if (sel.dataset.opcoes !== meses.join(",")) {
      sel.innerHTML = opts;
      sel.dataset.opcoes = meses.join(",");
    }
    if (state.mesFinanceiro && meses.includes(state.mesFinanceiro)) {
      sel.value = state.mesFinanceiro;
    } else {
      state.mesFinanceiro = meses[0];
      sel.value = state.mesFinanceiro;
    }
  }

  document.getElementById("financeiroMesSelect").addEventListener("change", (e) => {
    state.mesFinanceiro = e.target.value;
    renderFinanceiro();
  });

  function renderFinanceiro() {
    popularMesFinanceiroSelect_();
    const yyyyMM = state.mesFinanceiro;
    if (!yyyyMM) return;

    const totais = totaisFinanceiroMes_(yyyyMM);
    const totalSaidas = totais.custo + totais.taxa + totais.frete + totais.ads;
    const margem = totais.faturamento ? (totais.lucro / totais.faturamento) : 0;
    const rotuloConta = state.contaFinanceiro === "1" ? " — Conta 1" : state.contaFinanceiro === "2" ? " — Conta 2" : "";

    document.getElementById("finKpiRow").innerHTML = `
      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">${fmtMoney(totais.faturamento)}</span>
        <span class="fin-kpi__label">Entradas (faturamento) — ${fmtMesLabel_(yyyyMM + "-01")}${rotuloConta}</span>
      </div>
      <div class="fin-kpi fin-kpi--out">
        <span class="fin-kpi__value">${fmtMoney(totalSaidas)}</span>
        <span class="fin-kpi__label">Saídas (produto + taxa ML + frete + ads)</span>
      </div>
      <div class="fin-kpi fin-kpi--profit">
        <span class="fin-kpi__value">${fmtMoney(totais.lucro)}</span>
        <span class="fin-kpi__label">Lucro líquido (após ads)</span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtPct(margem)}</span>
        <span class="fin-kpi__label">Margem líquida${totais.semDadoAds ? " (ads não contabilizado nessa visão)" : ""}</span>
      </div>`;

    document.getElementById("finDevolucoesRow").innerHTML = `
      <div class="fin-kpi fin-kpi--out">
        <span class="fin-kpi__value">${fmtNum(totais.numDevolucoes)}</span>
        <span class="fin-kpi__label">Devoluções no mês (produto entregue e revertido)</span>
      </div>
      <div class="fin-kpi fin-kpi--out">
        <span class="fin-kpi__value">${fmtMoney(totais.valorDevolvido)}</span>
        <span class="fin-kpi__label">Valor reembolsado em devoluções</span>
      </div>
      <div class="fin-kpi ${totais.taxaDevolucao > 0.05 ? "fin-kpi--out" : ""}">
        <span class="fin-kpi__value">${fmtPct(totais.taxaDevolucao)}</span>
        <span class="fin-kpi__label">Margem de devolução</span>
      </div>`;

    // Quando a visão é "Ambas", mostra embaixo quanto foi faturado em CADA
    // conta separadamente — é o pedido de "as duas juntas, e embaixo o que
    // foi faturado em cada uma delas".
    const breakdown = document.getElementById("finContaBreakdown");
    if (state.contaFinanceiro === "ambas" && (state.transacoes_2.length || state.transacoes.length)) {
      const totaisConta1 = totaisFinanceiroMes_(yyyyMM, "1");
      const totaisConta2 = totaisFinanceiroMes_(yyyyMM, "2");
      breakdown.innerHTML = `
        <div class="fin-kpi">
          <span class="fin-kpi__value">${fmtMoney(totaisConta1.faturamento)}</span>
          <span class="fin-kpi__label">↳ Faturado na Conta 1</span>
        </div>
        <div class="fin-kpi">
          <span class="fin-kpi__value">${fmtMoney(totaisConta2.faturamento)}</span>
          <span class="fin-kpi__label">↳ Faturado na Conta 2</span>
        </div>`;
      breakdown.classList.remove("hidden");
    } else {
      breakdown.innerHTML = "";
      breakdown.classList.add("hidden");
    }

    if (!chartJsDisponivel_("financeiroChart")) return;
    if (financeiroChart) financeiroChart.destroy();

    let labels, fatData, saidaData, lucroData;
    if (state.financeiroView === "mensal") {
      // Compara o mês escolhido com o mês imediatamente anterior a ele —
      // dá contexto de tendência sem depender da janela fixa de 12 meses.
      const [ano, mes] = yyyyMM.split("-").map(Number);
      const anterior = new Date(ano, mes - 2, 1);
      const yyyyMMAnterior = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, "0")}`;
      const totaisAnterior = totaisFinanceiroMes_(yyyyMMAnterior);
      labels = [fmtMesLabel_(yyyyMMAnterior + "-01"), fmtMesLabel_(yyyyMM + "-01")];
      fatData = [totaisAnterior.faturamento, totais.faturamento];
      saidaData = [totaisAnterior.custo + totaisAnterior.taxa + totaisAnterior.frete + totaisAnterior.ads, totalSaidas];
      lucroData = [totaisAnterior.lucro, totais.lucro];
    } else {
      const dias = serieDiariaDoMes_(yyyyMM);
      labels = dias.map((d) => d.dia);
      fatData = dias.map((d) => d.faturamento);
      saidaData = dias.map((d) => d.saidas);
      lucroData = dias.map((d) => d.lucro);
    }

    financeiroChart = new Chart(document.getElementById("financeiroChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Faturamento", data: fatData, backgroundColor: "#3DDC97" },
          { label: "Custo + Taxas + Frete + Ads", data: saidaData, backgroundColor: "#FF6B6B" },
          { label: "Lucro líquido", data: lucroData, type: "line", borderColor: "#5B9CFF", backgroundColor: "transparent", tension: 0.3, pointRadius: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } },
      },
    });
  }

  document.getElementById("financeiroContaToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#financeiroContaToggle .toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.contaFinanceiro = btn.dataset.conta;
    renderFinanceiro();
  });

  document.getElementById("financeiroToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#financeiroToggle .toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.financeiroView = btn.dataset.view;
    renderFinanceiro();
  });

  // ------------------------------------------------- "Vendas de hoje ao vivo"
  // Réplica do painel do próprio Mercado Livre — sempre HOJE, sem filtro de
  // data, e somando as duas contas (não tem opção de olhar só uma aqui,
  // de propósito, pra ficar simples e direto como o original).
  function transacoesCombinadas_() {
    return state.transacoes.concat(state.transacoes_2);
  }

  function transacoesDoDia_(isoDate) {
    return transacoesCombinadas_().filter((t) => (t.data || "").slice(0, 10) === isoDate);
  }

  function totaisDoDia_(isoDate) {
    const txs = transacoesDoDia_(isoDate);
    const pedidos = new Set();
    let faturamento = 0, unidades = 0, lucro = 0;
    txs.forEach((t) => {
      faturamento += Number(t.faturamento || 0);
      unidades += Number(t.quantidade || 0);
      lucro += Number(t.lucro || 0);
      if (t.pedido_id) pedidos.add(t.pedido_id);
    });
    return { faturamento, unidades, lucro, numVendas: pedidos.size };
  }

  function renderHero() {
    const hoje = isoDate_(new Date());
    const totais = totaisDoDia_(hoje);

    document.getElementById("heroFaturamento").textContent = fmtMoney(totais.faturamento);
    document.getElementById("heroUnidades").textContent = fmtNum(totais.unidades);
    document.getElementById("heroLucro").textContent = fmtMoney(totais.lucro);

    const agora = new Date();
    document.getElementById("heroAtualizadoEm").textContent =
      "Atualizado às " + String(agora.getHours()).padStart(2, "0") + ":" + String(agora.getMinutes()).padStart(2, "0");

    renderMetricasChaveHoje_(totais);
    renderTendenciaHoraria_();
    renderMaisVendidosHoje_(hoje);
  }

  function renderMetricasChaveHoje_(totais) {
    const ticketMedio = totais.numVendas ? totais.faturamento / totais.numVendas : 0;
    const margem = totais.faturamento ? totais.lucro / totais.faturamento : 0;
    document.getElementById("metricasChaveHoje").innerHTML = `
      <div class="metrica-chave">
        <span class="metrica-chave__valor">${fmtNum(totais.numVendas)}</span>
        <span class="metrica-chave__label">Quantidade de vendas</span>
      </div>
      <div class="metrica-chave">
        <span class="metrica-chave__valor">${fmtMoney(ticketMedio)}</span>
        <span class="metrica-chave__label">Ticket médio</span>
      </div>
      <div class="metrica-chave">
        <span class="metrica-chave__valor">${fmtPct(margem)}</span>
        <span class="metrica-chave__label">Margem líquida hoje</span>
      </div>
      <div class="metrica-chave metrica-chave--indisponivel">
        <span class="metrica-chave__valor">—</span>
        <span class="metrica-chave__label">Visitas e conversão (ainda não disponível)</span>
      </div>`;
  }

  let tendenciaHorariaChart = null;
  function renderTendenciaHoraria_() {
    if (!chartJsDisponivel_("tendenciaHorariaChart")) return;

    const hoje = new Date();
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    const isoHoje = isoDate_(hoje), isoOntem = isoDate_(ontem);

    const porHora = (isoDia) => {
      const horas = new Array(24).fill(0);
      transacoesDoDia_(isoDia).forEach((t) => {
        if (!t.data_hora) return;
        const h = new Date(t.data_hora).getHours();
        horas[h] += Number(t.faturamento || 0);
      });
      return horas;
    };

    const serieHoje = porHora(isoHoje);
    const serieOntem = porHora(isoOntem);
    // Depois da hora atual, "hoje" ainda não tem como ter dado — corta a
    // linha ali (fica igual ao gráfico do Mercado Livre, que também para
    // no relógio, em vez de cair pra zero de propósito).
    const horaAtual = hoje.getHours();
    const serieHojeCortada = serieHoje.map((v, h) => (h <= horaAtual ? v : null));

    if (tendenciaHorariaChart) tendenciaHorariaChart.destroy();
    tendenciaHorariaChart = new Chart(document.getElementById("tendenciaHorariaChart"), {
      type: "line",
      data: {
        labels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
        datasets: [
          { label: "Hoje", data: serieHojeCortada, borderColor: "#5B9CFF", backgroundColor: "transparent", tension: 0.35, pointRadius: 0, spanGaps: false },
          { label: "Ontem", data: serieOntem, borderColor: "#FF6B9D", backgroundColor: "transparent", tension: 0.35, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { x: { title: { display: true, text: "Horas", font: { size: 10 } }, ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } },
      },
    });
  }

  function renderMaisVendidosHoje_(isoDia) {
    const fotoPorSku = {}, linkPorSku = {}, estoquePorSku = {};
    state.produtos.forEach((p) => {
      fotoPorSku[p["SKUs"]] = p["Foto URL"];
      linkPorSku[p["SKUs"]] = p["Link Anúncio"];
      estoquePorSku[p["SKUs"]] = Number(p["Estoque AnyMarket disponível"] || 0);
    });

    const grupos = {};
    transacoesDoDia_(isoDia).forEach((t) => {
      if (!grupos[t.sku]) grupos[t.sku] = { sku: t.sku, faturamento: 0 };
      grupos[t.sku].faturamento += Number(t.faturamento || 0);
    });
    const top = Object.values(grupos).sort((a, b) => b.faturamento - a.faturamento).slice(0, 5);

    const lista = document.getElementById("maisVendidosHojeLista");
    if (!top.length) {
      lista.innerHTML = `<p class="muted" style="padding:16px;text-align:center;">Nenhuma venda hoje ainda.</p>`;
      return;
    }
    lista.innerHTML = top.map((item, i) => {
      const estoque = estoquePorSku[item.sku];
      const avisoEstoque = estoque !== undefined && estoque <= 5
        ? `<span style="color:var(--saida);"> ⚠ estoque baixo</span>` : "";
      return `
        <div class="mv-item ${i === 0 ? "mv-item--primeiro" : ""}">
          <span class="mv-item__rank">${i + 1}</span>
          ${fmtFoto(fotoPorSku[item.sku])}
          <div class="mv-item__info">
            <div class="mv-item__titulo">${fmtSkuLink(item.sku, linkPorSku[item.sku])}</div>
            <div class="mv-item__meta">Estoque: ${fmtNum(estoque)} unidades${avisoEstoque}</div>
          </div>
          <span class="mv-item__valor">${fmtMoney(item.faturamento)}</span>
        </div>`;
    }).join("");
  }

  function renderTendencia() {
    const comVenda = state.produtos.filter((p) => Number(p["Últimos 30 dias"] || 0) > 0);
    const subindo = [], estavel = [], caindo = [];
    comVenda.forEach((p) => {
      const evol = Number(p["Evolução últimos 30 dias"] || 0);
      if (evol > 0.10) subindo.push(p);
      else if (evol < -0.10) caindo.push(p);
      else estavel.push(p);
    });
    subindo.sort((a, b) => Number(b["Evolução últimos 30 dias"]) - Number(a["Evolução últimos 30 dias"]));
    caindo.sort((a, b) => Number(a["Evolução últimos 30 dias"]) - Number(b["Evolução últimos 30 dias"]));
    estavel.sort((a, b) => Number(b["Últimos 30 dias"]) - Number(a["Últimos 30 dias"]));

    const card = (titulo, cls, lista) => `
      <div class="tend-card tend-card--${cls}">
        <div class="tend-card__head">
          <span class="tend-card__title">${titulo}</span>
          <span class="tend-card__count">${lista.length}</span>
        </div>
        ${lista.slice(0, 5).map((p) => `
          <div class="tend-item">
            <span class="tend-item__sku">${escapeHtml(p["SKUs"])}</span>
            <span class="tend-item__pct ${cls === "down" ? "down" : cls === "up" ? "up" : ""}">${fmtPct(p["Evolução últimos 30 dias"])}</span>
          </div>`).join("") || `<p class="muted" style="font-size:12px;">Nenhum produto aqui.</p>`}
      </div>`;

    document.getElementById("tendenciaRow").innerHTML =
      card("📈 Subindo (30d)", "up", subindo) +
      card("➡️ Estável (30d)", "flat", estavel) +
      card("📉 Caindo (30d)", "down", caindo);
  }

  function metaKey_() {
    const d = new Date();
    return `meta_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function renderAcoesHoje() {
    const itens = [];

    state.produtos.forEach((p) => {
      if (p["Inativo"]) return;
      const dias = p["Dias até Ruptura"];
      if (dias !== "-" && dias !== undefined && dias !== null && Number(dias) <= 7) {
        itens.push({
          sku: p["SKUs"], foto: p["Foto URL"], link: p["Link Anúncio"],
          tag: "🔴 Ruptura", tipo: "ruptura",
          desc: `Estoque acaba em ${dias} dia(s) — repor agora`,
          prioridade: 0 + Number(dias) / 100,
        });
      }
    });

    state.produtos.forEach((p) => {
      if (p["Inativo"]) return;
      if ((p["DIRETRIZ"] || "").includes("SAÍDA")) {
        itens.push({
          sku: p["SKUs"], foto: p["Foto URL"], link: p["Link Anúncio"],
          tag: "🟠 Em saída", tipo: "saida",
          desc: "Vendas fracas e nota baixa — considere promoção ou tirar de linha",
          prioridade: 1,
        });
      }
    });

    state.produtos.forEach((p) => {
      if (p["Inativo"]) return;
      const margem = p["_margem"];
      const fat = Number(p["_fat_rs"] || 0);
      if (margem !== undefined && margem < 0.10 && fat > 0 && !(p["DIRETRIZ"] || "").includes("SAÍDA")) {
        itens.push({
          sku: p["SKUs"], foto: p["Foto URL"], link: p["Link Anúncio"],
          tag: "🟡 Margem baixa", tipo: "margem",
          desc: `Margem de ${fmtPct(margem)} — revise custo ou preço`,
          prioridade: 2 - margem,
        });
      }
    });

    itens.sort((a, b) => a.prioridade - b.prioridade);

    const body = document.getElementById("acoesHojeBody");
    if (!itens.length) {
      body.innerHTML = `<p class="acao-vazio">Nenhuma prioridade urgente hoje — tudo dentro do esperado.</p>`;
      return;
    }
    body.innerHTML = itens.slice(0, 15).map((it) => `
      <div class="acao-item">
        ${fmtFoto(it.foto)}
        <span class="acao-item__tag acao-item__tag--${it.tipo}">${it.tag}</span>
        ${fmtSkuLink(it.sku, it.link)}
        <span class="acao-item__desc">${escapeHtml(it.desc)}</span>
      </div>`).join("");
  }

  function renderMeta() {
    const meta = Number(localStorage.getItem(metaKey_()) || 0);
    document.getElementById("metaInput").value = meta || "";

    const content = document.getElementById("metaContent");
    if (!meta) {
      content.innerHTML = `<p class="meta-empty">Defina uma meta de faturamento para este mês e acompanhe se o ritmo diário está suficiente para bater ela.</p>`;
      return;
    }

    const mensal = state.financeiro_mensal;
    const faturadoMes = mensal.length ? Number(mensal[mensal.length - 1].faturamento || 0) : 0;

    const hoje = new Date();
    const diaAtual = hoje.getDate();
    const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const diasRestantes = Math.max(diasNoMes - diaAtual, 0);

    const progresso = Math.min((faturadoMes / meta) * 100, 999);
    const projecao = diaAtual > 0 ? (faturadoMes / diaAtual) * diasNoMes : 0;
    const faltaAtingir = Math.max(meta - faturadoMes, 0);
    const ritmoNecessario = diasRestantes > 0 ? faltaAtingir / diasRestantes : (faltaAtingir > 0 ? Infinity : 0);
    const vaiBater = projecao >= meta;

    let corBarra = "critico";
    if (progresso >= 100) corBarra = "ok";
    else if (vaiBater) corBarra = "ok";
    else if (progresso >= 60) corBarra = "risco";

    content.innerHTML = `
      <div class="meta-progress-bar"><div class="meta-progress-fill ${corBarra}" style="width:${Math.min(progresso, 100)}%"></div></div>
      <p class="muted" style="font-size:12px;margin:0 0 12px;">${fmtMoney(faturadoMes)} de ${fmtMoney(meta)} — ${progresso.toFixed(0)}% da meta, dia ${diaAtual} de ${diasNoMes}</p>
      <div class="meta-grid">
        <div class="meta-stat">
          <span class="meta-stat__value">${fmtMoney(ritmoNecessario === Infinity ? faltaAtingir : ritmoNecessario)}</span>
          <span class="meta-stat__label">${diasRestantes > 0 ? "Precisa faturar por dia (dias restantes)" : "Faltam " + fmtMoney(faltaAtingir) + " — sem dias restantes"}</span>
        </div>
        <div class="meta-stat">
          <span class="meta-stat__value" style="color:${vaiBater ? "var(--manutencao)" : "var(--saida)"}">${fmtMoney(projecao)}</span>
          <span class="meta-stat__label">Projeção de fechamento (no ritmo atual)</span>
        </div>
        <div class="meta-stat">
          <span class="meta-stat__value" style="color:${vaiBater ? "var(--manutencao)" : "var(--saida)"}">${vaiBater ? "✅ Vai bater" : "⚠️ Abaixo da meta"}</span>
          <span class="meta-stat__label">Com base no ritmo até agora</span>
        </div>
      </div>`;
  }

  document.getElementById("metaSaveBtn").addEventListener("click", () => {
    const v = Number(document.getElementById("metaInput").value || 0);
    if (v > 0) localStorage.setItem(metaKey_(), String(v));
    else localStorage.removeItem(metaKey_());
    renderMeta();
  });

  // ---------------------------------------------------------------- events
  document.querySelectorAll("#productsTable thead th").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = "desc"; }
      renderTable();
    });
  });

  els.searchInput.addEventListener("input", (e) => { state.search = e.target.value; renderTable(); });
  els.refreshBtn.addEventListener("click", fetchData);

  function openSettings() {
    const cfg = loadConfig();
    els.apiUrl.value = cfg.apiUrl || "";
    els.apiToken.value = cfg.apiToken || "";
    els.settingsDialog.showModal();
  }
  els.settingsBtn.addEventListener("click", openSettings);
  els.emptyConnectBtn.addEventListener("click", openSettings);
  els.cancelSettings.addEventListener("click", () => els.settingsDialog.close());
  els.settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveConfig({ apiUrl: els.apiUrl.value.trim(), apiToken: els.apiToken.value.trim() });
    els.settingsDialog.close();
    fetchData();
  });

  document.getElementById("periodoToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#periodoToggle .toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.periodoView = btn.dataset.periodo;
    renderDailyChart();
  });

  document.getElementById("transToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#transToggle .toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.transModo = btn.dataset.modo;
    renderTransacoes();
  });

  function renderTransacoes() {
    const head = document.getElementById("transHead");
    const body = document.getElementById("transBody");
    const count = document.getElementById("transCount");
    const skuInfo = {};
    state.produtos.forEach((p) => { skuInfo[p["SKUs"]] = p["Fornecedor"]; });

    if (state.transModo === "detalhado") {
      head.innerHTML = `<th>Data</th><th>SKU</th><th>Fornecedor</th><th class="num">Qtd</th><th class="num">Faturamento</th><th class="num">Lucro</th>`;
      const linhas = [...state.transacoes].sort((a, b) => (a.data < b.data ? 1 : -1));
      count.textContent = `(${linhas.length})`;
      body.innerHTML = linhas.map((t) => `
        <tr>
          <td>${(t.data || "").slice(0, 10).split("-").reverse().join("/")}</td>
          <td class="sku-cell">${escapeHtml(t.sku)}</td>
          <td>${escapeHtml(skuInfo[t.sku] ?? "-")}</td>
          <td class="num">${fmtNum(t.quantidade)}</td>
          <td class="num">${fmtMoney(t.faturamento)}</td>
          <td class="num">${fmtMoney(t.lucro)}</td>
        </tr>`).join("");
    } else {
      head.innerHTML = `<th>SKU</th><th>Fornecedor</th><th class="num">Qtd total</th><th class="num">Faturamento total</th><th class="num">Lucro total</th><th class="num"># vendas</th>`;
      const grupos = {};
      state.transacoes.forEach((t) => {
        if (!grupos[t.sku]) grupos[t.sku] = { sku: t.sku, quantidade: 0, faturamento: 0, lucro: 0, n: 0 };
        grupos[t.sku].quantidade += Number(t.quantidade) || 0;
        grupos[t.sku].faturamento += Number(t.faturamento) || 0;
        grupos[t.sku].lucro += Number(t.lucro) || 0;
        grupos[t.sku].n += 1;
      });
      const linhas = Object.values(grupos).sort((a, b) => b.faturamento - a.faturamento);
      count.textContent = `(${linhas.length} SKUs)`;
      body.innerHTML = linhas.map((g) => `
        <tr>
          <td class="sku-cell">${escapeHtml(g.sku)}</td>
          <td>${escapeHtml(skuInfo[g.sku] ?? "-")}</td>
          <td class="num">${fmtNum(g.quantidade)}</td>
          <td class="num">${fmtMoney(g.faturamento)}</td>
          <td class="num">${fmtMoney(g.lucro)}</td>
          <td class="num">${g.n}</td>
        </tr>`).join("");
    }
  }

  document.getElementById("tabbar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.tab === tab));
    // Reconstrói os gráficos da aba que acabou de aparecer — o Chart.js
    // calcula o tamanho errado se for criado enquanto a aba está escondida.
    if (tab === "produtos" && state.produtos.length) renderCharts();
    if (tab === "financeiro" && state.produtos.length) renderFinanceiro();
  });

  document.getElementById("listaCompletaDetails").addEventListener("toggle", (e) => {
    if (e.target.open && state.produtos.length) renderCharts();
  });

  // ---------------------------------------------------------------- init
  initPeriodoPickers_();
  fetchData();
  setInterval(fetchData, 60000); // atualiza sozinho a cada 1 min
})();
