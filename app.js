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
    kpiRow: document.getElementById("kpiRow"),
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
      state.financeiro_mensal = data.financeiro_mensal || [];
      state.curva_abc = data.curva_abc || [];
      state.transacoes = data.transacoes || [];

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
    renderKpis();
    renderAbc();
    renderTendencia();
    renderRuptura();
    renderSaidaPorDia();
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
    if (selA.dataset.populated === String(meses.length)) return; // só popula 1x por quantidade de meses
    const opts = meses.map((m, i) => `<option value="${i}">${fmtMesLabel_(m.periodo)}</option>`).join("");
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    if (meses.length >= 2) { selA.value = String(meses.length - 2); selB.value = String(meses.length - 1); }
    selA.dataset.populated = String(meses.length);
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
    const idxA = Number(document.getElementById("mesASelect").value || 0);
    const idxB = Number(document.getElementById("mesBSelect").value || 0);
    const mesA = meses[idxA], mesB = meses[idxB];
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

  function initPeriodoPicker_() {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    document.getElementById("dataDe").value = isoDate_(ontem);
    document.getElementById("dataAte").value = isoDate_(ontem);
    marcarPresetAtivo_("ontem");
  }

  function marcarPresetAtivo_(preset) {
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.toggle("active", b.dataset.preset === preset));
  }

  document.getElementById("periodoPresets").addEventListener("click", (e) => {
    const btn = e.target.closest(".preset-btn");
    if (!btn) return;
    const hoje = new Date();
    const de = document.getElementById("dataDe"), ate = document.getElementById("dataAte");
    if (btn.dataset.preset === "hoje") { de.value = isoDate_(hoje); ate.value = isoDate_(hoje); }
    if (btn.dataset.preset === "ontem") {
      const o = new Date(hoje); o.setDate(o.getDate() - 1);
      de.value = isoDate_(o); ate.value = isoDate_(o);
    }
    if (btn.dataset.preset === "7dias") {
      const seteAtras = new Date(hoje); seteAtras.setDate(seteAtras.getDate() - 6);
      de.value = isoDate_(seteAtras); ate.value = isoDate_(hoje);
    }
    if (btn.dataset.preset === "mes") {
      de.value = isoDate_(new Date(hoje.getFullYear(), hoje.getMonth(), 1)); ate.value = isoDate_(hoje);
    }
    marcarPresetAtivo_(btn.dataset.preset);
    renderSaidaPorDia();
  });

  document.getElementById("dataDe").addEventListener("change", () => { marcarPresetAtivo_(null); renderSaidaPorDia(); });
  document.getElementById("dataAte").addEventListener("change", () => { marcarPresetAtivo_(null); renderSaidaPorDia(); });

  function renderSaidaPorDia() {
    const de = document.getElementById("dataDe").value;
    const ate = document.getElementById("dataAte").value;
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
    document.getElementById("periodoResumo").innerHTML = `
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtNum(totalQtd)}</span>
        <span class="fin-kpi__label">Unidades vendidas no período</span>
      </div>
      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">${fmtMoney(totalFat)}</span>
        <span class="fin-kpi__label">Faturamento no período</span>
      </div>`;

    const body = document.getElementById("diaBody");
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
      const margem = Number(p["_margem"] || 0);
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

  function renderKpis() {
    const counts = {};
    state.produtos.forEach((p) => {
      const key = diretrizClass(p["DIRETRIZ"]);
      counts[key] = (counts[key] || 0) + 1;
    });
    const order = [
      ["foco", "🔵 FOCO"], ["manutencao", "🟢 MANUTENÇÃO"], ["despriorizado", "🟡 DESPRIORIZADO"],
      ["saida", "🔴 SAÍDA"], ["ignorar", "⚫ IGNORAR"],
    ];
    els.kpiRow.innerHTML = order.map(([key, label]) => `
      <div class="kpi-card badge--${key}" style="border-color: transparent;">
        <span class="kpi-card__count">${counts[key] || 0}</span>
        <span class="kpi-card__label">${label}</span>
      </div>`).join("");
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

  function renderTable() {
    const rows = filteredSortedProducts();
    els.rowCount.textContent = `(${rows.length})`;
    els.productsBody.innerHTML = rows.map((p, i) => `
      <tr class="data-row" data-idx="${i}">
        <td>${fmtFoto(p["Foto URL"])}</td>
        <td>${fmtSkuLink(p["SKUs"], p["Link Anúncio"])}</td>
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

  function renderFinanceiro() {
    const serie = state.financeiroView === "mensal" ? state.financeiro_mensal : state.financeiro_diario;
    const totais = serie.reduce((acc, p) => ({
      faturamento: acc.faturamento + Number(p.faturamento || 0),
      custo: acc.custo + Number(p.custo || 0),
      taxa: acc.taxa + Number(p.taxa_ml || 0),
      frete: acc.frete + Number(p.frete || 0),
      ads: acc.ads + Number(p.gasto_ads || 0),
      lucro: acc.lucro + Number(p.lucro_liquido || 0),
    }), { faturamento: 0, custo: 0, taxa: 0, frete: 0, ads: 0, lucro: 0 });
    const totalSaidas = totais.custo + totais.taxa + totais.frete + totais.ads;
    const margem = totais.faturamento ? (totais.lucro / totais.faturamento) : 0;

    document.getElementById("finKpiRow").innerHTML = `
      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">${fmtMoney(totais.faturamento)}</span>
        <span class="fin-kpi__label">Entradas (faturamento)</span>
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
        <span class="fin-kpi__label">Margem líquida</span>
      </div>`;

    if (!chartJsDisponivel_("financeiroChart")) return;
    if (financeiroChart) financeiroChart.destroy();
    financeiroChart = new Chart(document.getElementById("financeiroChart"), {
      type: "bar",
      data: {
        labels: serie.map((p) => (p.periodo || "").slice(state.financeiroView === "mensal" ? 0 : 5)),
        datasets: [
          { label: "Faturamento", data: serie.map((p) => p.faturamento), backgroundColor: "#3DDC97" },
          { label: "Custo + Taxas + Frete + Ads", data: serie.map((p) => Number(p.custo || 0) + Number(p.taxa_ml || 0) + Number(p.frete || 0) + Number(p.gasto_ads || 0)), backgroundColor: "#FF6B6B" },
          { label: "Lucro líquido", data: serie.map((p) => p.lucro_liquido), type: "line", borderColor: "#5B9CFF", backgroundColor: "transparent", tension: 0.3, pointRadius: 2 },
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

  document.getElementById("financeiroToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#financeiroToggle .toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.financeiroView = btn.dataset.view;
    renderFinanceiro();
  });

  function renderHero() {
    const fin = state.financeiro_diario;
    if (!fin.length) return;
    const hoje = fin[fin.length - 1];
    const anteriores = fin.slice(Math.max(0, fin.length - 8), fin.length - 1); // até 7 dias antes de hoje
    const mediaAnterior = (campo) => anteriores.length
      ? anteriores.reduce((s, d) => s + Number(d[campo] || 0), 0) / anteriores.length
      : 0;

    const unidadesPorDia = (idx) => state.saida_diaria.reduce((s, p) => s + Number((p.serie[idx] || {}).quantidade || 0), 0);
    const idxHoje = (state.saida_diaria[0]?.serie.length || 1) - 1;
    const unidadesHoje = unidadesPorDia(idxHoje);
    let unidadesMedia = 0;
    if (idxHoje > 0) {
      const janela = Math.min(7, idxHoje);
      for (let k = 1; k <= janela; k++) unidadesMedia += unidadesPorDia(idxHoje - k);
      unidadesMedia = unidadesMedia / janela;
    }

    setHeroStat('heroFaturamento', 'heroFaturamentoDelta', fmtMoney(hoje.faturamento), hoje.faturamento, mediaAnterior('faturamento'));
    setHeroStat('heroUnidades', 'heroUnidadesDelta', fmtNum(unidadesHoje), unidadesHoje, unidadesMedia);
    setHeroStat('heroLucro', 'heroLucroDelta', fmtMoney(hoje.lucro_liquido), hoje.lucro_liquido, mediaAnterior('lucro_liquido'));
  }

  function setHeroStat(valueId, deltaId, displayValue, valor, media) {
    document.getElementById(valueId).textContent = displayValue;
    const deltaEl = document.getElementById(deltaId);
    if (!media || media === 0) { deltaEl.textContent = ''; deltaEl.className = 'hero__caption'; return; }
    const pct = ((valor - media) / media) * 100;
    const seta = pct >= 0 ? '▲' : '▼';
    deltaEl.textContent = `${seta} ${Math.abs(pct).toFixed(0)}% vs média`;
    deltaEl.className = 'hero__caption ' + (pct >= 0 ? 'up' : 'down');
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
  initPeriodoPicker_();
  fetchData();
  setInterval(fetchData, 60000); // atualiza sozinho a cada 1 min
})();
