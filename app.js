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
    diaFinanceiro: null,
    contaFinanceiro: "ambas",
    caixaMes: null,
    caixaOrigem: "todas",
    periodoView: "dia",
    transModo: "detalhado",
    sortKey: "qtd30",
    sortDir: "desc",
    search: "",
    diretrizFiltro: new Set(),
    classifFiltro: new Set(),
    // Filtro do card "Capital da empresa": "hoje" é a foto real; "mes" e
    // "dia" trocam pra visão de movimento do período escolhido.
    capitalPeriodo: { modo: "hoje", valor: "" },
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
      state.transacoes_2 = data.transacoes_2 || [];
      state.devolucoes = data.devolucoes || [];
      state.devolucoes_2 = data.devolucoes_2 || [];
      state.movimentos_mp = (data.movimentos_mp || []).map((m) => ({ ...m, contaMp: "1" }));
      state.movimentos_mp_2 = (data.movimentos_mp_2 || []).map((m) => ({ ...m, contaMp: "2" }));
      state.contas_pagar = data.contas_pagar || [];
      state.contas_receber = data.contas_receber || [];
      state.produtos_conta1_raw = data.produtos_conta1_raw || [];
      state.produtos_conta2_raw = data.produtos_conta2_raw || [];

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

      // Uma linha por ANÚNCIO (não por SKU) — se o mesmo SKU existir nas
      // duas contas, aparece 2x, cada uma com seus próprios números. É
      // calculado só uma vez aqui (não em cada tecla digitada na busca).
      state.linhasProdutosPorConta = construirLinhasPorConta_();

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
    renderCaixa();
    renderApagar();
    renderAreceber();
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
  // Antes usava new Date(iso) pra extrair o mês — mas "YYYY-MM-DD" (sem
  // hora) o JavaScript interpreta como meia-noite em UTC, e como o
  // navegador está no fuso de Brasília (3h atrás), ao ler o mês de volta
  // ele "voltava" pro dia anterior — fazendo agosto aparecer rotulado como
  // julho, julho como junho, etc. Ler o texto direto evita isso de vez.
  function fmtMesLabel_(iso) {
    const [ano, mes] = String(iso).split("-").map(Number);
    return `${MESES_ABREV[mes - 1]}/${String(ano).slice(2)}`;
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

  // Percentual do preço de venda que NÃO fica com a gente: comissão do
  // Mercado Livre + frete. É a média real da casa (12 meses, todos os SKUs),
  // usada como referência pra produto que ainda não vendeu e por isso não
  // tem histórico próprio. Não inclui o custo do produto — o custo entra
  // separado, senão seria contado duas vezes.
  function taxaFreteMediaGeral_() {
    let fat = 0, taxa = 0, frete = 0;
    (state.linhasProdutosPorConta || []).forEach((p) => {
      fat += Number(p.fat12m || 0);
      taxa += Number(p.taxa12m || 0);
      frete += Number(p.frete12m || 0);
    });
    if (fat <= 0) return 0.18; // sem histórico nenhum: ~18%, ordem de grandeza do ML
    return Math.min(Math.max((taxa + frete) / fat, 0), 0.95);
  }

  // Quanto por cento do preço some em taxa + frete PARA ESTE ANÚNCIO, com
  // base nas vendas reais dele nos últimos 12 meses. Se ele nunca vendeu,
  // cai na média da casa.
  function taxaFreteDoProduto_(p, mediaGeral) {
    const fat = Number(p.fat12m || 0);
    if (fat <= 0) return mediaGeral;
    const r = (Number(p.taxa12m || 0) + Number(p.frete12m || 0)) / fat;
    if (!isFinite(r) || r < 0) return mediaGeral;
    return Math.min(r, 0.95);
  }

  function renderEstoque() {
    const somenteSemCusto = document.getElementById("semCustoFiltro").checked;
    const apenasComEstoque = document.getElementById("apenasComEstoqueFiltro").checked;
    let totalParado = 0, totalPotencial = 0, totalLucroPotencial = 0;
    const taxaFreteMedia = taxaFreteMediaGeral_();
    // Usa as linhas POR CONTA (mesmas da "Lista completa de produtos") —
    // se o mesmo SKU existir nas duas contas, cada uma aparece com seu
    // próprio estoque/preço/custo, sem somar uma na outra. Antes, usar o
    // SKU combinado fazia o preço/estoque de uma conta "vazar" pra métrica
    // da outra.
    let linhas = (state.linhasProdutosPorConta || []).map((p) => {
      const estoque = p.estoque;
      const custo = p.custo;
      const preco = p.precoAtual;
      const precoOriginal = p.precoOriginal;
      // LUCRO REAL: o que sobra no bolso vendendo HOJE, no preço de hoje.
      //
      // Regra da casa (RAW_Vendas): Lucro = Faturamento − Custo − Taxa ML −
      // Frete. Ou seja, o "lucro" do histórico JÁ está líquido de custo.
      // Por isso aqui a gente usa só a fatia de taxa+frete do histórico e
      // desconta o custo UMA vez, com o custo de hoje:
      //
      //   recebido por unidade = preço − (preço × taxa+frete%)
      //   lucro por unidade     = recebido − custo
      //
      // A % de taxa+frete vem das vendas reais DESTE anúncio nos últimos 12
      // meses (então já embute comissão, frete grátis, tipo de anúncio); se
      // ele nunca vendeu, usa a média real da casa.
      const taxaFrete = taxaFreteDoProduto_(p, taxaFreteMedia);
      const recebidoPorUnidade = preco * (1 - taxaFrete);
      const lucroPorUnidade = recebidoPorUnidade - custo;
      // Margem mostrada na tabela = margem líquida de verdade sobre o preço.
      const margemReal = preco > 0 ? lucroPorUnidade / preco : 0;

      const valorParado = estoque * custo;
      const valorPotencial = estoque * preco;
      // Sem Math.max(0, ...): se o produto dá prejuízo no preço atual, o
      // número tem que aparecer negativo. Esconder isso é justamente o que
      // fazia a conta parecer boa quando não era.
      const lucroPotencial = estoque * lucroPorUnidade;
      // Os 3 indicadores do topo SEMPRE consideram só quem tem estoque de
      // verdade (> 0) E custo preenchido (> 0) — produto sem custo
      // cadastrado normalmente é um anúncio ainda não revisado/cadastrado
      // corretamente, e o "estoque" que o Mercado Livre reporta pra ele às
      // vezes não é confiável (ex: anúncio antigo, teste, ou duplicado).
      // Isso é sempre assim, independente do checkbox "só com estoque"
      // abaixo, que só controla o que aparece NA LISTA.
      if (estoque > 0 && custo > 0) {
        totalParado += valorParado;
        totalPotencial += valorPotencial;
        totalLucroPotencial += lucroPotencial;
      }
      return {
        sku: p.sku, conta: p.conta, titulo: p.titulo, foto: p.foto, link: p.link,
        estoque, custo, valorParado, preco, precoOriginal, margem: margemReal, lucroPotencial,
        taxaFrete, recebidoPorUnidade, semHistorico: !(Number(p.fat12m) > 0),
      };
    }).sort((a, b) => b.valorParado - a.valorParado);

    document.getElementById("estoqueKpiRow").innerHTML = `
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(totalParado)}</span>
        <span class="fin-kpi__label">Capital parado em estoque (custo) <span class="muted">— só com custo preenchido</span></span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(totalPotencial)}</span>
        <span class="fin-kpi__label">Valor de venda potencial <span class="muted">— só com custo preenchido</span></span>
      </div>
      <div class="fin-kpi ${totalLucroPotencial < 0 ? "fin-kpi--out" : "fin-kpi--profit"}">
        <span class="fin-kpi__value">${fmtMoney(totalLucroPotencial)}</span>
        <span class="fin-kpi__label">Lucro líquido do estoque <span class="muted">— já sem comissão ML e frete, no preço de hoje</span></span>
      </div>`;

    // Por padrão, a lista já exclui quem não tem custo preenchido (mesma
    // regra dos 3 cards do topo) — geralmente é anúncio ainda não revisado,
    // e o "estoque" que aparece pra ele não é confiável. O checkbox abaixo
    // inverte isso: quando marcado, mostra SÓ esses itens sem custo, pra
    // você conseguir revisar e preencher.
    if (somenteSemCusto) linhas = linhas.filter((l) => !l.custo);
    else linhas = linhas.filter((l) => l.custo > 0);
    if (apenasComEstoque) linhas = linhas.filter((l) => l.estoque > 0);

    document.getElementById("estoqueBody").innerHTML = linhas.map((l) => `
      <tr>
        <td>${fmtFoto(l.foto)}</td>
        <td>${fmtSkuLink(l.sku, l.link)}</td>
        <td><span class="conta-badge conta-badge--${l.conta}">${l.conta}</span></td>
        <td class="titulo-cell">${escapeHtml(l.titulo || "-")}</td>
        <td class="num">${fmtNum(l.estoque)}</td>
        <td class="num">
          <input type="number" step="0.01" min="0" class="custo-edit" data-sku="${escapeHtml(l.sku)}" value="${l.custo || ""}" placeholder="0,00">
          <span class="custo-save-msg" data-sku-msg="${escapeHtml(l.sku)}"></span>
        </td>
        <td class="num">${fmtMoney(l.valorParado)}</td>
        <td class="num">${fmtPrecoComPromo(l.precoOriginal, l.preco)}</td>
        <td class="num">${fmtPct(l.margem)}</td>
        <td class="num">${fmtMoney(l.lucroPotencial)}</td>
      </tr>`).join("");

    document.querySelectorAll(".custo-edit").forEach((input) => {
      input.addEventListener("change", () => salvarCusto_(input));
    });
  }

  document.getElementById("semCustoFiltro").addEventListener("change", renderEstoque);
  document.getElementById("apenasComEstoqueFiltro").addEventListener("change", renderEstoque);

  async function salvarCusto_(input) {
    const sku = input.dataset.sku;
    const custo = Number(input.value || 0);
    // Usa o span de mensagem que está DENTRO DA MESMA CÉLULA desse input
    // específico — não um seletor global por SKU, porque agora o mesmo SKU
    // pode aparecer em 2 linhas (uma por conta), e um seletor global sempre
    // acharia a primeira, mostrando "✓ salvo" na linha errada.
    const msg = input.closest("td").querySelector(".custo-save-msg");
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
      // Atualiza o valor localmente (nas duas fontes de dados) pra Capital
      // Parado/Margem já refletirem sem esperar o próximo fetch automático.
      // O custo é o MESMO pra esse SKU nas duas contas (aba Custos é
      // compartilhada), então atualiza toda linha que tiver esse SKU.
      const produto = state.produtos.find((p) => p["SKUs"] === sku);
      if (produto) produto["Custo Unitário"] = custo;
      (state.linhasProdutosPorConta || []).forEach((l) => { if (l.sku === sku) l.custo = custo; });
      renderEstoque();
    } catch (err) {
      msg.textContent = "✗ erro ao salvar";
      msg.className = "custo-save-msg erro";
    } finally {
      input.classList.remove("salvando");
    }
  }

  // ===================================================== CURVA ABC / PERFIL
  //
  // Classifica uma lista pelo método clássico de Pareto: ordena do maior
  // pro menor, vai acumulando, e corta em 80% e 95%.
  //   A = os que somam os primeiros 80% do total
  //   B = os próximos 15% (até 95%)
  //   C = a cauda, os últimos 5%
  //
  // Devolve um mapa chave → "A" | "B" | "C". Quem tem valor zero ou
  // negativo fica de fora (não classifica), senão a cauda vira uma massa
  // de zeros que distorce os cortes.
  function classificarAbc_(itens, valorDe, chaveDe) {
    const validos = itens.filter((i) => valorDe(i) > 0)
      .sort((a, b) => valorDe(b) - valorDe(a));
    const total = validos.reduce((s, i) => s + valorDe(i), 0);
    const classe = {};
    let acumulado = 0;
    validos.forEach((i) => {
      acumulado += valorDe(i);
      const p = total > 0 ? acumulado / total : 1;
      classe[chaveDe(i)] = p <= 0.8 ? "A" : p <= 0.95 ? "B" : "C";
    });
    return classe;
  }

  // Perfil do produto, cruzando as curvas COM a margem.
  //
  // A ideia vem da planilha: uma letra só não diz o que fazer com o
  // produto. Vender muito com margem apertada é um negócio; vender pouco
  // com margem alta é outro. O cruzamento é que orienta a decisão.
  //
  // A margem entra porque só as letras não bastam. Testei sem ela e um
  // produto com 50% de margem, respondendo por 36% do lucro da casa, caiu
  // em "Potencial" — só porque o corte de Pareto do lucro é estreito e ele
  // ficou em B. Margem é o que de fato separa Premium de Volume.
  //
  // REGRA USADA (se a sua for diferente, me diz que eu ajusto):
  //   Estrela   A em lucro e gira bem (A ou B em quantidade)
  //   Premium   lucro relevante (A ou B) e margem acima da mediana, mas
  //             gira pouco — cada venda vale muito, não sacrifique preço
  //   Volume    gira bem (A ou B em quantidade) com margem abaixo da
  //             mediana — aqui um ajuste de preço rende
  //   Potencial tem A ou B em alguma das três, sem se encaixar acima
  //   Análise   C em tudo, ou sem venda nos 12 meses
  const PERFIL_ORDEM = { "Estrela": 1, "Premium": 2, "Volume": 3, "Potencial": 4, "Análise": 5 };

  function medianaMargem_(itens) {
    const ms = itens.filter((i) => i.fat12m > 0).map((i) => i.lucro12m / i.fat12m).sort((a, b) => a - b);
    if (!ms.length) return 0;
    const meio = Math.floor(ms.length / 2);
    return ms.length % 2 ? ms[meio] : (ms[meio - 1] + ms[meio]) / 2;
  }

  function perfilProduto_(cFat, cLucro, cQtd, margem, margemMediana) {
    if (!cFat && !cLucro && !cQtd) return "Análise";
    const giraBem = cQtd === "A" || cQtd === "B";
    const lucroBom = cLucro === "A" || cLucro === "B";
    const margemAlta = margem > margemMediana;

    if (cLucro === "A" && giraBem) return "Estrela";
    if (lucroBom && margemAlta && !giraBem) return "Premium";
    if (giraBem && !margemAlta) return "Volume";
    if (cFat === "A" || cFat === "B" || lucroBom || giraBem) return "Potencial";
    return "Análise";
  }

  // Monta a curva a partir dos dados do próprio site (Mercado Livre), em
  // vez de ler uma curva pronta de uma aba. Assim ela reflete o que
  // aconteceu de verdade nos últimos 12 meses, sem depender de a planilha
  // ter sido recalculada.
  function construirCurvaAbc_() {
    // Consolida por SKU: a curva é do PRODUTO, não do anúncio. O mesmo SKU
    // nas duas contas é um produto só na hora de decidir estratégia.
    const porSku = new Map();
    (state.linhasProdutosPorConta || []).forEach((p) => {
      const a = porSku.get(p.sku) || {
        sku: p.sku, titulo: p.titulo, fornecedor: p.fornecedor, categoria: p.categoria,
        foto: p.foto, link: p.link,
        fat12m: 0, lucro12m: 0, qtd12m: 0, qtd30: 0, estoque: 0, custo: 0, inativo: true,
      };
      a.fat12m += Number(p.fat12m || 0);
      a.lucro12m += Number(p.lucro12m || 0);
      a.qtd12m += Number(p.qtd12m || 0);
      a.qtd30 += Number(p.qtd30 || 0);
      a.estoque += Number(p.estoque || 0);
      a.custo = Math.max(a.custo, Number(p.custo || 0));
      if (!p.inativo) a.inativo = false;
      if (!a.titulo && p.titulo) a.titulo = p.titulo;
      porSku.set(p.sku, a);
    });

    const itens = Array.from(porSku.values());
    const chave = (i) => i.sku;
    const cFat   = classificarAbc_(itens, (i) => i.fat12m,   chave);
    const cLucro = classificarAbc_(itens, (i) => i.lucro12m, chave);
    const cQtd   = classificarAbc_(itens, (i) => i.qtd12m,   chave);
    // Curva do giro ATUAL (últimos 30 dias) — é a que mostra o que está
    // vendendo agora, não o que vendeu no ano passado.
    const cAtual = classificarAbc_(itens, (i) => i.qtd30, chave);

    const margemMediana = medianaMargem_(itens);
    itens.forEach((i) => {
      i.classeFat   = cFat[i.sku]   || "";
      i.classeLucro = cLucro[i.sku] || "";
      i.classeQtd   = cQtd[i.sku]   || "";
      i.classeAtual = cAtual[i.sku] || "";
      i.margem = i.fat12m > 0 ? i.lucro12m / i.fat12m : 0;
      i.perfil = perfilProduto_(i.classeFat, i.classeLucro, i.classeQtd, i.margem, margemMediana);
      // Dias de estoque no ritmo dos últimos 30 dias
      const porDia = i.qtd30 / 30;
      i.diasEstoque = porDia > 0 ? Math.round(i.estoque / porDia) : null;
    });

    itens.sort((a, b) => {
      const d = (PERFIL_ORDEM[a.perfil] || 9) - (PERFIL_ORDEM[b.perfil] || 9);
      return d !== 0 ? d : b.fat12m - a.fat12m;
    });
    return itens;
  }

  function renderAbc() {
    const itens = construirCurvaAbc_();
    const el = document.getElementById("abcRow");
    if (!el) return;

    if (!itens.length) {
      el.innerHTML = `<p class="muted">Sem dados de venda para montar a curva.</p>`;
      return;
    }

    const totalFat = itens.reduce((s, i) => s + i.fat12m, 0);
    const totalLucro = itens.reduce((s, i) => s + i.lucro12m, 0);

    const PERFIS = ["Estrela", "Premium", "Volume", "Potencial", "Análise"];
    const EXPLICA = {
      "Estrela":   "vende muito e dá lucro",
      "Premium":   "gira pouco, cada venda vale muito",
      "Volume":    "gira muito, margem apertada",
      "Potencial": "perto de subir de faixa",
      "Análise":   "revisar se vale continuar",
    };

    const cards = PERFIS.map((perfil) => {
      const lista = itens.filter((i) => i.perfil === perfil);
      if (!lista.length) return "";
      const fat = lista.reduce((s, i) => s + i.fat12m, 0);
      const lucro = lista.reduce((s, i) => s + i.lucro12m, 0);
      const pctFat = totalFat ? (fat / totalFat) * 100 : 0;
      const pctLucro = totalLucro ? (lucro / totalLucro) * 100 : 0;
      return `
        <div class="abc-card abc-card--${perfil === "Estrela" ? "A" : perfil === "Análise" ? "C" : "B"}">
          <div class="abc-card__letter">${perfil}</div>
          <div class="abc-card__count">${lista.length} produto(s) · ${EXPLICA[perfil]}</div>
          <div class="abc-card__pct">${pctLucro.toFixed(1)}%</div>
          <div class="abc-card__pct-label">do lucro (12M) · ${fmtMoney(lucro)}<br>
            ${pctFat.toFixed(1)}% do faturamento · ${fmtMoney(fat)}</div>
        </div>`;
    }).join("");

    const linhas = itens.slice(0, 200).map((i) => `
      <tr>
        <td>${fmtFoto(i.foto)}</td>
        <td>${fmtSkuLink(i.sku, i.link)}</td>
        <td class="titulo-cell">${escapeHtml(i.titulo || "-")}</td>
        <td>${badgePerfil_(i.perfil)}</td>
        <td class="num">${badgeClasse_(i.classeFat)}</td>
        <td class="num">${badgeClasse_(i.classeLucro)}</td>
        <td class="num">${badgeClasse_(i.classeQtd)}</td>
        <td class="num">${badgeClasse_(i.classeAtual)}</td>
        <td class="num">${fmtMoney(i.fat12m)}</td>
        <td class="num">${fmtMoney(i.lucro12m)}</td>
        <td class="num">${fmtPct(i.margem)}</td>
        <td class="num">${fmtNum(i.qtd30)}</td>
        <td class="num">${fmtNum(i.estoque)}</td>
        <td class="num">${i.diasEstoque === null ? "-" : fmtNum(i.diasEstoque)}</td>
      </tr>`).join("");

    el.innerHTML = `
      ${cards}
      <div style="grid-column:1/-1;margin-top:20px;">
        <p class="muted" style="font-size:12px;margin-bottom:8px;">
          Curva calculada sobre os últimos 12 meses de venda do Mercado Livre (as duas contas juntas,
          por SKU). Corte de Pareto: A = primeiros 80% do total, B = até 95%, C = o resto.
          "Giro atual" usa os últimos 30 dias. O perfil cruza as três curvas com a margem —
          a mediana da casa hoje é ${fmtPct(medianaMargem_(itens))}, e é ela que separa Premium de Volume.
        </p>
        <div style="overflow:auto;">
        <table class="data-table">
          <thead><tr>
            <th></th><th>SKU</th><th>Título</th><th>Perfil</th>
            <th>Fat.</th><th>Lucro</th><th>Qtd</th><th>Giro atual</th>
            <th>Faturamento 12M</th><th>Lucro 12M</th><th>Margem</th>
            <th>Vendas 30d</th><th>Estoque</th><th>Dias de estoque</th>
          </tr></thead>
          <tbody>${linhas}</tbody>
        </table>
        </div>
        ${itens.length > 200 ? `<p class="muted" style="font-size:12px;">Mostrando os 200 primeiros de ${itens.length}.</p>` : ""}
      </div>`;
  }

  function badgeClasse_(c) {
    if (!c) return `<span class="muted">-</span>`;
    return `<span class="badge badge--${c === "A" ? "foco" : c === "B" ? "manutencao" : "despriorizado"}">${c}</span>`;
  }

  function badgePerfil_(p) {
    const cls = p === "Estrela" ? "foco" : p === "Premium" ? "manutencao"
              : p === "Volume" ? "baixo" : p === "Potencial" ? "despriorizado" : "ignorar";
    return `<span class="badge badge--${cls}">${escapeHtml(p)}</span>`;
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

  // Constrói 1 linha por ANÚNCIO (SKU + conta), sem consolidar entre
  // contas — se o mesmo SKU existir nas duas, aparece 2 vezes, cada uma
  // com seus próprios números de estoque, preço, vendas, faturamento e
  // lucro. Calculado 1x quando os dados chegam, não em cada tecla digitada.
  function construirLinhasPorConta_() {
    // Custo, Classificação e DIRETRIZ continuam vindo do SKU combinado
    // (Fluxo por SKU) — é a mesma peça física e a mesma classificação
    // estratégica, então não faz sentido duplicar isso por conta.
    const custoPorSku = {}, diretrizPorSku = {}, classifPorSku = {};
    state.produtos.forEach((p) => {
      custoPorSku[p["SKUs"]] = Number(p["Custo Unitário"] || 0);
      diretrizPorSku[p["SKUs"]] = p["DIRETRIZ"];
      classifPorSku[p["SKUs"]] = p["Classificação"];
    });

    const hojeIso = isoDate_(new Date());
    const ontemD = new Date(); ontemD.setDate(ontemD.getDate() - 1);
    const ontemIso = isoDate_(ontemD);

    function metricas_(sku, porSkuMap) {
      const doSku = porSkuMap[sku] || [];
      const somaDesde = (dias, campo) => {
        const limite = new Date(); limite.setDate(limite.getDate() - dias);
        const limiteIso = isoDate_(limite);
        return doSku.filter((t) => (t.data || "") >= limiteIso).reduce((s, t) => s + Number(t[campo] || 0), 0);
      };
      const somaExata = (diaIso, campo) => doSku.filter((t) => t.data === diaIso).reduce((s, t) => s + Number(t[campo] || 0), 0);
      const datas = doSku.map((t) => t.data).filter(Boolean).sort();

      return {
        qtdHoje: somaExata(hojeIso, "quantidade"),
        qtdOntem: somaExata(ontemIso, "quantidade"),
        qtd7: somaDesde(7, "quantidade"),
        qtd15: somaDesde(15, "quantidade"),
        qtd30: somaDesde(30, "quantidade"),
        // "período anterior" (ex: dias -14 a -7) — usado só pra calcular a evolução
        qtdPrev7: somaDesde(14, "quantidade") - somaDesde(7, "quantidade"),
        qtdPrev30: somaDesde(60, "quantidade") - somaDesde(30, "quantidade"),
        fat12m: somaDesde(365, "faturamento"),
        lucro12m: somaDesde(365, "lucro"),
        // Componentes do lucro separados. Precisamos deles separados porque
        // "lucro" na RAW_Vendas já vem LÍQUIDO DE CUSTO
        // (Lucro = Faturamento − Custo − Taxa ML − Frete). Pra projetar o
        // lucro do estoque parado a gente precisa da parte que NÃO é custo
        // (taxa + frete), senão o custo entra na conta duas vezes.
        custo12m: somaDesde(365, "custo"),
        taxa12m: somaDesde(365, "taxa_ml"),
        frete12m: somaDesde(365, "frete"),
        qtd12m: somaDesde(365, "quantidade"),
        ultimaVenda: datas.length ? datas[datas.length - 1] : null,
      };
    }

    function situacao_(estoque, mediaVendasDia, ultimaVenda) {
      if (!ultimaVenda) return { texto: "Produto novo", classe: "foco", emoji: "🔵" };
      if (mediaVendasDia <= 0) return { texto: "Sem vendas", classe: "ignorar", emoji: "⚫" };
      const dre = estoque / mediaVendasDia;
      if (dre <= 3) return { texto: "Comprar urgente", classe: "saida", emoji: "🔴" };
      if (dre <= 10) return { texto: "Estoque baixo", classe: "baixo", emoji: "🟠" };
      if (dre <= 30) return { texto: "Atenção", classe: "despriorizado", emoji: "🟡" };
      return { texto: "Estoque saudável", classe: "manutencao", emoji: "🟢" };
    }

    function construirConta_(raw, conta, porSkuMap) {
      const sku = raw.sku;
      const estoque = Number(raw.estoque || 0);
      const custo = custoPorSku[sku] !== undefined ? custoPorSku[sku] : Number(raw.custo || 0);
      const met = metricas_(sku, porSkuMap);
      const mediaVendasDia = met.qtd30 / 30;
      const diasRestantes = mediaVendasDia > 0 ? estoque / mediaVendasDia : null;
      const evolucao30 = met.qtdPrev30 > 0 ? (met.qtd30 - met.qtdPrev30) / met.qtdPrev30 : (met.qtd30 > 0 ? 1 : 0);
      const sit = situacao_(estoque, mediaVendasDia, met.ultimaVenda);
      // Velocidade dos últimos 15 dias, mesmo critério já usado em "Fluxo
      // por SKU" pra prever ruptura — só que agora calculado por conta.
      const vel15 = met.qtd15 / 15;
      const diasRuptura = vel15 > 0 ? Math.round(estoque / vel15) : (estoque > 0 ? null : 0);

      return {
        sku, conta, fornecedor: raw.fornecedor, categoria: raw.categoria, foto: raw.foto, link: raw.link,
        titulo: raw.titulo || "",
        // Anúncio que saiu do ar. O WebApp.gs já mandava esse campo (coluna
        // G de RAW_Estoque) e ninguém usava — era por isso que o site somava
        // no capital produto que a planilha já tinha excluído.
        inativo: !!raw.inativo,
        estoque, reserva: Number(raw.reserva || 0),
        precoOriginal: Number(raw.preco_original || 0), precoAtual: Number(raw.preco_atual || 0),
        custo,
        qtdHoje: met.qtdHoje, qtdOntem: met.qtdOntem, qtd7: met.qtd7, qtd15: met.qtd15, qtd30: met.qtd30,
        evolucao30,
        mediaVendasDia,
        diasRestantes,
        diasRestantesOrdenacao: diasRestantes === null ? (estoque > 0 ? 999999 : -1) : diasRestantes,
        ultimaVenda: met.ultimaVenda,
        ultimaVendaOrdenacao: met.ultimaVenda ? new Date(met.ultimaVenda).getTime() : -1,
        fat12m: met.fat12m, lucro12m: met.lucro12m,
        custo12m: met.custo12m, taxa12m: met.taxa12m, frete12m: met.frete12m, qtd12m: met.qtd12m,
        margem: met.fat12m ? met.lucro12m / met.fat12m : 0,
        situacao: sit, situacaoOrdenacao: sit.texto,
        diasRuptura,
        diasRupturaOrdenacao: diasRuptura === null ? (estoque > 0 ? 999999 : -1) : diasRuptura,
        classificacao: classifPorSku[sku] || "-",
        diretriz: diretrizPorSku[sku] || "⚫ IGNORAR",
      };
    }

    const porSku1 = {}, porSku2 = {};
    state.transacoes.forEach((t) => { (porSku1[t.sku] = porSku1[t.sku] || []).push(t); });
    state.transacoes_2.forEach((t) => { (porSku2[t.sku] = porSku2[t.sku] || []).push(t); });

    const linhas = [];
    (state.produtos_conta1_raw || []).forEach((raw) => linhas.push(construirConta_(raw, "1", porSku1)));
    (state.produtos_conta2_raw || []).forEach((raw) => linhas.push(construirConta_(raw, "2", porSku2)));
    return linhas;
  }

  function fmtUltimaVenda_(iso) {
    if (!iso) return "Nunca vendeu";
    const hoje = isoDate_(new Date());
    if (iso === hoje) return "Hoje";
    const ontemD = new Date(); ontemD.setDate(ontemD.getDate() - 1);
    if (iso === isoDate_(ontemD)) return "Ontem";
    const dias = Math.round((new Date(hoje + "T12:00:00") - new Date(iso + "T12:00:00")) / 86400000);
    return `Há ${dias} dias`;
  }

  function fmtMediaVendasDia_(n) {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "/dia";
  }

  function fmtDiasRestantes_(dias, estoque) {
    if (dias === null || dias === undefined) {
      return estoque > 0 ? `<span class="badge badge--ignorar">-</span>` : `<span class="badge badge--saida">0d</span>`;
    }
    const n = Math.round(dias);
    const classe = n <= 3 ? "saida" : n <= 10 ? "baixo" : n <= 30 ? "despriorizado" : "manutencao";
    return `<span class="badge badge--${classe}">${n}d</span>`;
  }

  function fmtSituacao_(sit) {
    return `<span class="badge badge--${sit.classe}">${sit.emoji} ${escapeHtml(sit.texto)}</span>`;
  }

  function filteredSortedProducts() {
    const term = state.search.trim().toLowerCase();
    let rows = (state.linhasProdutosPorConta || []).filter((p) => {
      if (term) {
        const hay = `${p.sku ?? ""} ${p.fornecedor ?? ""} ${p.categoria ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (state.diretrizFiltro.size && !state.diretrizFiltro.has(p.diretriz)) return false;
      if (state.classifFiltro.size && !state.classifFiltro.has(p.classificacao)) return false;
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
        <td>${fmtFoto(p.foto)}</td>
        <td>${fmtSkuLink(p.sku, p.link)}</td>
        <td><span class="conta-badge conta-badge--${p.conta}">${p.conta}</span></td>
        <td>${escapeHtml(p.fornecedor ?? "-")}</td>
        <td>${escapeHtml(p.categoria ?? "-")}</td>
        <td class="num">${fmtPrecoComPromo(p.precoOriginal, p.precoAtual)}</td>
        <td class="num">${fmtNum(p.estoque)}</td>
        <td class="num">${fmtNum(p.reserva)}</td>
        <td class="num">${fmtNum(p.qtdHoje)}</td>
        <td class="num">${fmtNum(p.qtdOntem)}</td>
        <td class="num">${fmtNum(p.qtd7)}</td>
        <td class="num">${fmtNum(p.qtd15)}</td>
        <td class="num">${fmtNum(p.qtd30)}</td>
        <td class="num">${fmtPct(p.evolucao30)}</td>
        <td class="num">${fmtMediaVendasDia_(p.mediaVendasDia)}</td>
        <td class="num">${fmtUltimaVenda_(p.ultimaVenda)}</td>
        <td class="num">${fmtDiasRestantes_(p.diasRestantes, p.estoque)}</td>
        <td class="num">${fmtMoney(p.fat12m)}</td>
        <td class="num">${fmtMoney(p.lucro12m)}</td>
        <td class="num">${fmtPct(p.margem)}</td>
        <td class="num">${fmtRupturaBadge(p.diasRuptura === null ? "-" : p.diasRuptura)}</td>
        <td>${fmtSituacao_(p.situacao)}</td>
        <td>${badge(p.classificacao, "classif")}</td>
        <td>${badge(p.diretriz)}</td>
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

    const serie = (state.saida_diaria.find((d) => d.sku === product.sku) || {}).serie || [];
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
        plugins: { legend: { display: false }, title: { display: true, text: `Saída diária — ${product.sku}`, font: { size: 11 } } },
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
    const devolucoes = devolucoesDoMes_(yyyyMM, contaEfetiva);
    const agregado = agregarFinanceiro_(txs, devolucoes);

    // "Gasto Ads" é digitado manualmente na planilha, pra CONTA 1 e sem
    // divisão por conta — só entra na conta quando a visão é "Ambas"
    // (que é o total real que ele representa). Olhando só a Conta 1 ou só
    // a Conta 2 isoladamente, não temos como saber qual fatia do Ads é de
    // qual conta, então não subtraímos (fica documentado no aviso).
    const mesInfo = state.financeiro_mensal.find((m) => (m.periodo || "").slice(0, 7) === yyyyMM);
    const ads = contaEfetiva === "ambas" && mesInfo ? Number(mesInfo.gasto_ads || 0) : 0;
    const semDadoAds = contaEfetiva === "ambas" ? !mesInfo : true;

    const lucro = agregado.faturamento - agregado.custo - agregado.taxa - agregado.frete - ads;
    return { ...agregado, ads, lucro, semDadoAds };
  }

  // Reúne os totais de faturamento/custo/taxa/frete + devoluções de uma
  // lista de transações — usado tanto pro mês inteiro quanto pra um único
  // dia, pra não duplicar essa conta duas vezes.
  function agregarFinanceiro_(txs, devolucoes) {
    const base = txs.reduce((acc, t) => ({
      faturamento: acc.faturamento + Number(t.faturamento || 0),
      custo: acc.custo + Number(t.custo || 0),
      taxa: acc.taxa + Number(t.taxa_ml || 0),
      frete: acc.frete + Number(t.frete || 0),
    }), { faturamento: 0, custo: 0, taxa: 0, frete: 0 });

    const pedidosPagos = new Set(txs.map((t) => t.pedido_id).filter(Boolean));
    const pedidosDevolvidos = new Set(devolucoes.map((d) => d.pedido_id).filter(Boolean));
    const valorDevolvido = devolucoes.reduce((s, d) => s + Number(d.valor_reembolsado || 0), 0);
    // O pedido devolvido já saiu de RAW_Vendas (por isso não está em "txs"),
    // então pro total de pedidos do período precisamos somar os dois: os
    // que ainda estão contando como venda + os que foram pagos e depois
    // devolvidos. Sem isso, a taxa de devolução ficaria artificialmente alta.
    const totalPedidosNoPeriodo = pedidosPagos.size + pedidosDevolvidos.size;
    const taxaDevolucao = totalPedidosNoPeriodo ? pedidosDevolvidos.size / totalPedidosNoPeriodo : 0;

    return {
      ...base,
      numPedidos: pedidosPagos.size,
      numDevolucoes: pedidosDevolvidos.size,
      valorDevolvido,
      taxaDevolucao,
    };
  }

  // ------------------------------------------------------- visão por dia
  function transacoesDoDiaFin_(isoDia, conta) {
    return transacoesPorConta_(conta || state.contaFinanceiro).filter((t) => (t.data || "") === isoDia);
  }

  function devolucoesDoDiaFin_(isoDia, conta) {
    return devolucoesPorConta_(conta || state.contaFinanceiro)
      .filter((d) => (d.data || "") === isoDia && d.tipo === "Devolução");
  }

  function totaisFinanceiroDia_(isoDia, conta) {
    const contaEfetiva = conta || state.contaFinanceiro;
    const txs = transacoesDoDiaFin_(isoDia, contaEfetiva);
    const devolucoes = devolucoesDoDiaFin_(isoDia, contaEfetiva);
    const agregado = agregarFinanceiro_(txs, devolucoes);

    // Ads do dia só existe de verdade se esse dia ainda estiver dentro da
    // janela rolante de 30 dias de "Financeiro Diário" (dado manual, sem
    // divisão por conta) — mesma regra do mês: só aplica em "Ambas".
    const diaInfo = state.financeiro_diario.find((d) => (d.periodo || "").slice(0, 10) === isoDia);
    const ads = contaEfetiva === "ambas" && diaInfo ? Number(diaInfo.gasto_ads || 0) : 0;
    const semDadoAds = contaEfetiva === "ambas" ? !diaInfo : true;

    const lucro = agregado.faturamento - agregado.custo - agregado.taxa - agregado.frete - ads;
    return { ...agregado, ads, lucro, semDadoAds };
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

  function mesAnteriorDe_(yyyyMM) {
    const [ano, mes] = yyyyMM.split("-").map(Number);
    const d = new Date(ano, mes - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function diasNoMes_(yyyyMM) {
    const [ano, mes] = yyyyMM.split("-").map(Number);
    return new Date(ano, mes, 0).getDate();
  }

  function fmtDiaLabel_(iso) {
    const [ano, mes, dia] = String(iso).split("-");
    return `${dia}/${mes}/${ano}`;
  }

  // % de variação de "atual" vs "anterior" — null quando não há base de
  // comparação (mês anterior sem nenhum dado), pra não mostrar "∞%".
  function variacaoPct_(atual, anterior) {
    if (!anterior) return null;
    return (atual - anterior) / Math.abs(anterior);
  }

  function fmtDelta_(pct) {
    if (pct === null || pct === undefined || !isFinite(pct)) return "";
    const seta = pct >= 0 ? "▲" : "▼";
    const classe = pct >= 0 ? "up" : "down";
    return ` <span class="fin-kpi__delta fin-kpi__delta--${classe}">${seta} ${Math.abs(pct * 100).toFixed(0)}% vs mês anterior</span>`;
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

  document.getElementById("financeiroDiaSelect").addEventListener("change", (e) => {
    state.diaFinanceiro = e.target.value;
    renderFinanceiro();
  });

  function mudarDia_(delta) {
    const atual = state.diaFinanceiro ? new Date(state.diaFinanceiro + "T12:00:00") : new Date();
    atual.setDate(atual.getDate() + delta);
    state.diaFinanceiro = isoDate_(atual);
    document.getElementById("financeiroDiaSelect").value = state.diaFinanceiro;
    renderFinanceiro();
  }
  document.getElementById("diaAnteriorBtn").addEventListener("click", () => mudarDia_(-1));
  document.getElementById("diaProximoBtn").addEventListener("click", () => mudarDia_(1));

  function renderFinanceiro() {
    const noModoDia = state.financeiroView === "diario";
    document.getElementById("financeiroMesSelect").classList.toggle("hidden", noModoDia);
    document.getElementById("financeiroDiaControles").classList.toggle("hidden", !noModoDia);

    popularMesFinanceiroSelect_();
    if (noModoDia && !state.diaFinanceiro) state.diaFinanceiro = isoDate_(new Date());
    if (noModoDia) document.getElementById("financeiroDiaSelect").value = state.diaFinanceiro;

    const yyyyMM = state.mesFinanceiro;
    if (!yyyyMM) return;

    // No modo Diário, tudo é calculado pro dia escolhido; a "referência
    // anterior" pra mostrar a variação é a MÉDIA diária do mês passado
    // (não faz sentido comparar 1 dia com 1 mês inteiro). No modo Mensal,
    // a referência é simplesmente o mês anterior completo.
    const yyyyMMAnterior = mesAnteriorDe_(noModoDia ? state.diaFinanceiro.slice(0, 7) : yyyyMM);
    const totaisMesAnterior = totaisFinanceiroMes_(yyyyMMAnterior);
    const diasMesAnterior = diasNoMes_(yyyyMMAnterior);

    let totais, tituloPeriodo, refFaturamento, refSaidas, refLucro, refMargem;
    if (noModoDia) {
      totais = totaisFinanceiroDia_(state.diaFinanceiro);
      tituloPeriodo = fmtDiaLabel_(state.diaFinanceiro);
      const divisor = diasMesAnterior || 1;
      refFaturamento = totaisMesAnterior.faturamento / divisor;
      refSaidas = (totaisMesAnterior.custo + totaisMesAnterior.taxa + totaisMesAnterior.frete + totaisMesAnterior.ads) / divisor;
      refLucro = totaisMesAnterior.lucro / divisor;
      refMargem = totaisMesAnterior.faturamento ? totaisMesAnterior.lucro / totaisMesAnterior.faturamento : null;
    } else {
      totais = totaisFinanceiroMes_(yyyyMM);
      tituloPeriodo = fmtMesLabel_(yyyyMM + "-01");
      refFaturamento = totaisMesAnterior.faturamento;
      refSaidas = totaisMesAnterior.custo + totaisMesAnterior.taxa + totaisMesAnterior.frete + totaisMesAnterior.ads;
      refLucro = totaisMesAnterior.lucro;
      refMargem = totaisMesAnterior.faturamento ? totaisMesAnterior.lucro / totaisMesAnterior.faturamento : null;
    }

    const totalSaidas = totais.custo + totais.taxa + totais.frete + totais.ads;
    const margem = totais.faturamento ? (totais.lucro / totais.faturamento) : 0;
    const rotuloConta = state.contaFinanceiro === "1" ? " — Conta 1" : state.contaFinanceiro === "2" ? " — Conta 2" : "";

    document.getElementById("finKpiRow").innerHTML = `
      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">${fmtMoney(totais.faturamento)}</span>
        <span class="fin-kpi__label">Entradas (faturamento) — ${tituloPeriodo}${rotuloConta}</span>
        ${fmtDelta_(variacaoPct_(totais.faturamento, refFaturamento))}
      </div>
      <div class="fin-kpi fin-kpi--out">
        <span class="fin-kpi__value">${fmtMoney(totalSaidas)}</span>
        <span class="fin-kpi__label">Saídas (produto + taxa ML + frete + ads)</span>
        ${fmtDelta_(variacaoPct_(totalSaidas, refSaidas))}
      </div>
      <div class="fin-kpi fin-kpi--profit">
        <span class="fin-kpi__value">${fmtMoney(totais.lucro)}</span>
        <span class="fin-kpi__label">Lucro líquido (após ads)</span>
        ${fmtDelta_(variacaoPct_(totais.lucro, refLucro))}
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtPct(margem)}</span>
        <span class="fin-kpi__label">Margem líquida${totais.semDadoAds ? " (ads não contabilizado nessa visão)" : ""}</span>
        ${refMargem !== null ? fmtDelta_(variacaoPct_(margem, refMargem)) : ""}
      </div>`;

    document.getElementById("finDevolucoesRow").innerHTML = `
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtNum(totais.numPedidos)}</span>
        <span class="fin-kpi__label">Quantidade de pedidos</span>
      </div>
      <div class="fin-kpi fin-kpi--out">
        <span class="fin-kpi__value">${fmtNum(totais.numDevolucoes)}</span>
        <span class="fin-kpi__label">Devoluções (produto entregue e revertido)</span>
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
    // conta separadamente — no período (mês ou dia) que estiver selecionado.
    const breakdown = document.getElementById("finContaBreakdown");
    if (state.contaFinanceiro === "ambas" && (state.transacoes_2.length || state.transacoes.length)) {
      const totaisConta1 = noModoDia ? totaisFinanceiroDia_(state.diaFinanceiro, "1") : totaisFinanceiroMes_(yyyyMM, "1");
      const totaisConta2 = noModoDia ? totaisFinanceiroDia_(state.diaFinanceiro, "2") : totaisFinanceiroMes_(yyyyMM, "2");
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

    // O gráfico continua no mesmo formato de sempre: no modo Mensal,
    // compara o mês escolhido com o anterior; no modo Diário, mostra o
    // dia a dia do MÊS que contém o dia escolhido, pra dar contexto.
    let labels, fatData, saidaData, lucroData;
    if (!noModoDia) {
      labels = [fmtMesLabel_(yyyyMMAnterior + "-01"), fmtMesLabel_(yyyyMM + "-01")];
      fatData = [totaisMesAnterior.faturamento, totais.faturamento];
      saidaData = [totaisMesAnterior.custo + totaisMesAnterior.taxa + totaisMesAnterior.frete + totaisMesAnterior.ads, totalSaidas];
      lucroData = [totaisMesAnterior.lucro, totais.lucro];
    } else {
      const dias = serieDiariaDoMes_(state.diaFinanceiro.slice(0, 7));
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

  // --------------------------------------------------------------- Caixa
  // Plano de contas do módulo financeiro (baseado na especificação que
  // você mandou) — cada categoria já sabe se entra ou não na DRE, pra você
  // não ter que marcar isso na mão em cada lançamento.
  const PLANO_CONTAS = [
    { grupo: "Receitas", impactaDre: true, categorias: ["Receita Marketplace", "Outras Receitas", "Reembolsos"] },
    { grupo: "Custos", impactaDre: true, categorias: ["Mercadorias", "Matéria-prima", "Embalagens", "Fretes", "Produção"] },
    { grupo: "Despesas Operacionais", impactaDre: true, categorias: ["Marketing", "Contabilidade", "Sistemas", "Internet", "Energia", "Telefonia", "Aluguel", "Pró-labore", "Serviços de terceiros", "Logística", "Tarifas bancárias"] },
    { grupo: "Financeiras", impactaDre: true, categorias: ["Juros", "IOF", "Antecipações", "Tarifas financeiras"] },
    { grupo: "Patrimoniais (fora da DRE)", impactaDre: false, categorias: ["Empréstimos recebidos", "Pagamento de empréstimos", "Transferências entre contas", "Aportes", "Distribuição de lucros", "Retirada de sócios"] },
  ];

  function categoriaImpactaDre_(categoria) {
    for (const g of PLANO_CONTAS) if (g.categorias.includes(categoria)) return g.impactaDre;
    return true; // categoria desconhecida/vazia: assume que entra, pra não escondermos nada por engano
  }

  function opcoesPlanoContasHtml_(categoriaAtual) {
    return `<option value="">— categorizar —</option>` + PLANO_CONTAS.map((g) => `
      <optgroup label="${escapeHtml(g.grupo)}">
        ${g.categorias.map((c) => `<option value="${escapeHtml(c)}" ${c === categoriaAtual ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </optgroup>`).join("");
  }

  function movimentosMpCombinados_() {
    return (state.movimentos_mp || []).concat(state.movimentos_mp_2 || []);
  }

  // ---- filtros de status do Mercado Pago -------------------------------
  // O que faz um pagamento contar como DINHEIRO DE VERDADE é o status do
  // PAGAMENTO ser "approved". Reembolsado (refunded), cancelado
  // (cancelled), chargeback (charged_back) e recusado (rejected) são
  // dinheiro que não vai entrar (ou que entrou e já saiu de volta pro
  // comprador) — e o detalhe traiçoeiro: um pagamento assim NUNCA chega a
  // ser "released", então o status de liberação dele fica "pending" (ou em
  // branco) pra sempre. Antes, o site só olhava o status de LIBERAÇÃO —
  // era exatamente isso que fazia o "Total a receber" ficar MAIOR que o
  // valor real do app do Mercado Pago (pagamentos devolvidos somando como
  // "a receber" eternamente) e deixava até pagamento recusado contar como
  // entrada no Caixa.
  function pagamentoAprovado_(m) {
    return String(m.status || "").toLowerCase() === "approved";
  }

  // Valor que conta de verdade: o LÍQUIDO (já sem a comissão do ML — é o
  // que bate com o app do Mercado Pago), menos a parte proporcional de
  // qualquer reembolso PARCIAL (pagamento parcialmente reembolsado continua
  // "approved", mas parte do dinheiro voltou pro comprador). Reembolso
  // total nem chega aqui — o status vira "refunded" e o pagamento é
  // excluído pelo pagamentoAprovado_ acima.
  function valorLiquidoEfetivo_(m) {
    const base = Number(m.valor_liquido || m.valor || 0);
    const bruto = Number(m.valor || 0);
    const reembolsado = Number(m.valor_reembolsado || 0);
    if (reembolsado > 0 && bruto > 0) {
      return Math.max(0, base * (1 - Math.min(reembolsado / bruto, 1)));
    }
    return base;
  }

  function mesesDisponiveisCaixa_() {
    const set = new Set();
    movimentosMpCombinados_().forEach((m) => {
      const mm = (m.data_liberacao || m.data || "").slice(0, 7);
      if (mm) set.add(mm);
    });
    const hoje = new Date();
    set.add(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`);
    return Array.from(set).sort().reverse();
  }

  function popularCaixaMesSelect_() {
    const sel = document.getElementById("caixaMesSelect");
    const meses = mesesDisponiveisCaixa_();
    const opts = meses.map((m) => `<option value="${m}">${fmtMesLabel_(m + "-01")}</option>`).join("");
    if (sel.dataset.opcoes !== meses.join(",")) {
      sel.innerHTML = opts;
      sel.dataset.opcoes = meses.join(",");
    }
    if (state.caixaMes && meses.includes(state.caixaMes)) sel.value = state.caixaMes;
    else { state.caixaMes = meses[0]; sel.value = state.caixaMes; }
  }

  document.getElementById("caixaMesSelect").addEventListener("change", (e) => {
    state.caixaMes = e.target.value;
    renderCaixa();
  });

  document.getElementById("caixaOrigemToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    document.querySelectorAll("#caixaOrigemToggle .toggle-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.caixaOrigem = btn.dataset.origem;
    renderCaixa();
  });

  // Nomes amigáveis pros métodos de pagamento que o Mercado Pago devolve —
  // lista não exaustiva, qualquer um não mapeado aparece com a primeira
  // letra maiúscula, então nunca fica em branco.
  const METODOS_PAGAMENTO_MP = {
    account_money: "Saldo em conta",
    pix: "Pix",
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
    bank_transfer: "Transferência bancária",
    ticket: "Boleto",
  };
  function fmtMetodoPagamento_(metodo) {
    if (!metodo) return "Não identificado";
    if (METODOS_PAGAMENTO_MP[metodo]) return METODOS_PAGAMENTO_MP[metodo];
    return metodo.charAt(0).toUpperCase() + metodo.slice(1).replace(/_/g, " ");
  }

  // "De onde entrou": agrupa por Mercado Livre (que já sabemos com
  // certeza) e, pro resto, pelo método de pagamento — assim ainda dá pra
  // distinguir Pix de transferência, mesmo sem ter vindo de uma venda.
  function renderOrigemBreakdown_(linhas) {
    const grupos = {};
    linhas.forEach((m) => {
      const chave = m.origem === "Mercado Livre" ? "Mercado Livre" : fmtMetodoPagamento_(m.metodo_pagamento);
      grupos[chave] = (grupos[chave] || 0) + valorLiquidoEfetivo_(m);
    });
    const total = Object.values(grupos).reduce((s, v) => s + v, 0);
    const ordenado = Object.entries(grupos).sort((a, b) => b[1] - a[1]);

    const el = document.getElementById("caixaOrigemBreakdown");
    if (!ordenado.length || !total) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="origem-breakdown__titulo">De onde entrou</div>` +
      ordenado.map(([nome, valor]) => {
        const pct = (valor / total) * 100;
        return `
          <div class="origem-item">
            <span class="origem-item__nome">${escapeHtml(nome)}</span>
            <div class="origem-item__barra-fundo"><div class="origem-item__barra" style="width:${pct.toFixed(1)}%"></div></div>
            <span class="origem-item__valor">${fmtMoney(valor)} · ${pct.toFixed(0)}%</span>
          </div>`;
      }).join("");
  }

  // "Disponível" = já liberado pelo Mercado Livre (você já pode usar esse
  // dinheiro). "A liberar" = já é seu, mas o Mercado Livre ainda está
  // retendo (normalmente libera uns dias depois da venda). Isso evita a
  // confusão de olhar o total e achar que já tem tudo isso na mão.
  function renderMercadoLivreDisponivel_(yyyyMM) {
    const doMes = movimentosMpCombinados_()
      .filter((m) => (m.data || "").slice(0, 7) === yyyyMM && m.origem === "Mercado Livre" && pagamentoAprovado_(m));
    const disponivel = doMes.filter((m) => m.status_liberacao === "released").reduce((s, m) => s + valorLiquidoEfetivo_(m), 0);
    const aLiberar = doMes.filter((m) => m.status_liberacao === "pending").reduce((s, m) => s + valorLiquidoEfetivo_(m), 0);
    const total = disponivel + aLiberar;

    document.getElementById("caixaMlRow").innerHTML = `
      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">${fmtMoney(disponivel)}</span>
        <span class="fin-kpi__label">🟢 Disponível (já liberado)</span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(aLiberar)}</span>
        <span class="fin-kpi__label">🟡 A liberar (ainda retido pelo ML)</span>
      </div>
      <div class="fin-kpi fin-kpi--profit">
        <span class="fin-kpi__value">${fmtMoney(total)}</span>
        <span class="fin-kpi__label">Total de vendas do Mercado Livre no mês</span>
      </div>`;
  }

  function renderCaixa() {
    popularCaixaMesSelect_();
    const yyyyMM = state.caixaMes;
    if (!yyyyMM) return;

    // Caixa mostra só o que JÁ ESTÁ LIBERADO (o dinheiro que já é seu de
    // verdade, disponível hoje) — o que ainda está "pendente" de liberação
    // pelo Mercado Livre aparece em "A Receber", não aqui. Quando o
    // Mercado Livre libera, o status muda sozinho e o lançamento passa a
    // contar aqui automaticamente, sem precisar mover nada na mão.
    // O mês considerado é o da LIBERAÇÃO (quando o dinheiro realmente
    // entrou no caixa), não o da venda — pra bater com "o que já entrou".
    // E só pagamento APROVADO conta: antes, um pagamento recusado ou
    // cancelado (que tem status de liberação em branco, não "pending")
    // passava pelo filtro e somava como entrada — dinheiro que nunca
    // existiu inflando o caixa.
    let linhas = movimentosMpCombinados_().filter((m) => {
      if (!pagamentoAprovado_(m)) return false;
      if (m.status_liberacao === "pending") return false;
      const mesEfetivo = (m.data_liberacao || m.data || "").slice(0, 7);
      return mesEfetivo === yyyyMM;
    });
    if (state.caixaOrigem !== "todas") linhas = linhas.filter((m) => m.origem === state.caixaOrigem);
    linhas = linhas.slice().sort((a, b) => (a.data < b.data ? 1 : -1));

    const totalEntradas = linhas.reduce((s, m) => s + valorLiquidoEfetivo_(m), 0);
    const totalMarketplace = linhas.filter((m) => m.origem === "Mercado Livre").reduce((s, m) => s + valorLiquidoEfetivo_(m), 0);
    const totalOutras = totalEntradas - totalMarketplace;
    const naoCategorizados = linhas.filter((m) => !m.categoria).length;

    renderOrigemBreakdown_(linhas);
    renderMercadoLivreDisponivel_(yyyyMM);

    document.getElementById("caixaKpiRow").innerHTML = `
      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">${fmtMoney(totalEntradas)}</span>
        <span class="fin-kpi__label">Total de entradas — ${fmtMesLabel_(yyyyMM + "-01")}</span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(totalMarketplace)}</span>
        <span class="fin-kpi__label">Receita Marketplace (auto)</span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(totalOutras)}</span>
        <span class="fin-kpi__label">Outras entradas</span>
      </div>
      <div class="fin-kpi ${naoCategorizados > 0 ? "fin-kpi--out" : ""}">
        <span class="fin-kpi__value">${fmtNum(naoCategorizados)}</span>
        <span class="fin-kpi__label">Lançamentos sem categoria</span>
      </div>`;

    document.getElementById("caixaCount").textContent = `(${linhas.length})`;
    document.getElementById("caixaBody").innerHTML = linhas.map((m) => `
      <tr>
        <td>${((m.data_liberacao || m.data) || "").split("-").reverse().join("/")}</td>
        <td class="titulo-cell" style="max-width:280px;">${escapeHtml(m.descricao || "-")}</td>
        <td><span class="conta-badge conta-badge--${m.contaMp}">${m.contaMp}</span></td>
        <td><span class="conta-badge conta-badge--${m.origem === "Mercado Livre" ? "1" : "2"}" style="width:auto;border-radius:10px;padding:2px 8px;">${escapeHtml(m.origem || "-")}</span></td>
        <td class="sku-cell">${escapeHtml(m.pedido_ml || "-")}</td>
        <td>
          <select class="search-input categoria-mp-select" data-pagamento-id="${escapeHtml(m.pagamento_id)}" data-conta-mp="${m.contaMp}" style="min-width:170px;">
            ${opcoesPlanoContasHtml_(m.categoria)}
          </select>
        </td>
        <td class="num">${fmtPrecoComPromo(m.valor, m.valor_liquido || m.valor)}${Number(m.valor_reembolsado) > 0 ? `<br><span class="price-promo">-${fmtMoney(m.valor_reembolsado)} reemb.</span>` : ""}</td>
        <td>${m.status_liberacao === "released" ? "✅ Liberado" : m.status_liberacao === "pending" ? "⏳ Pendente" : escapeHtml(m.status_liberacao || "-")}</td>
      </tr>`).join("");

    document.querySelectorAll(".categoria-mp-select").forEach((sel) => {
      sel.addEventListener("change", () => salvarCategoriaMovimentoMP_(sel));
    });
  }

  async function salvarCategoriaMovimentoMP_(select) {
    const pagamentoId = select.dataset.pagamentoId;
    const categoria = select.value;
    if (!categoria) return;
    const cfg = loadConfig();
    select.disabled = true;
    try {
      const resp = await fetch(cfg.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: cfg.apiToken, acao: "categorizar_movimento_mp", pagamento_id: pagamentoId, categoria, salvar_regra: true, conta_mp: select.dataset.contaMp }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "erro");
      const mov = movimentosMpCombinados_().find((m) => m.pagamento_id === pagamentoId);
      if (mov) mov.categoria = categoria;
    } catch (err) {
      alert("Não foi possível salvar a categoria: " + err.message);
    } finally {
      select.disabled = false;
    }
  }

  // ------------------------------------------------------- Contas a Pagar
  function categoriasFlatOptionsHtml_() {
    return `<option value="">Categoria</option>` + PLANO_CONTAS.map((g) => `
      <optgroup label="${escapeHtml(g.grupo)}">
        ${g.categorias.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
      </optgroup>`).join("");
  }
  document.getElementById("apagarCategoria").innerHTML = categoriasFlatOptionsHtml_();
  document.getElementById("areceberCategoria").innerHTML = categoriasFlatOptionsHtml_();

  function fmtStatusBadge_(status) {
    const classe = status.toLowerCase().replace(/\s+/g, "-");
    return `<span class="status-badge status-badge--${classe}">${escapeHtml(status)}</span>`;
  }

  function diasAteVencimento_(iso) {
    if (!iso) return null;
    const hoje = isoDate_(new Date());
    return Math.round((new Date(iso + "T12:00:00") - new Date(hoje + "T12:00:00")) / 86400000);
  }

  function renderApagar() {
    const contas = (state.contas_pagar || []).slice().sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
    const pendentes = contas.filter((c) => c.status === "Pendente");
    const totalPendente = pendentes.reduce((s, c) => s + Number(c.valor || 0), 0);
    const vencendo7 = pendentes.filter((c) => { const d = diasAteVencimento_(c.vencimento); return d !== null && d >= 0 && d <= 7; })
      .reduce((s, c) => s + Number(c.valor || 0), 0);
    const vencidas = pendentes.filter((c) => { const d = diasAteVencimento_(c.vencimento); return d !== null && d < 0; });
    const totalVencido = vencidas.reduce((s, c) => s + Number(c.valor || 0), 0);
    const hojeIso = isoDate_(new Date());
    const pagoNoMes = contas.filter((c) => c.status === "Pago" && (c.data_pagamento || "").slice(0, 7) === hojeIso.slice(0, 7))
      .reduce((s, c) => s + Number(c.valor || 0), 0);

    document.getElementById("apagarKpiRow").innerHTML = `
      <div class="fin-kpi fin-kpi--out">
        <span class="fin-kpi__value">${fmtMoney(totalPendente)}</span>
        <span class="fin-kpi__label">Total pendente</span>
      </div>
      <div class="fin-kpi ${vencendo7 > 0 ? "fin-kpi--out" : ""}">
        <span class="fin-kpi__value">${fmtMoney(vencendo7)}</span>
        <span class="fin-kpi__label">Vencendo nos próximos 7 dias</span>
      </div>
      <div class="fin-kpi ${totalVencido > 0 ? "fin-kpi--out" : ""}">
        <span class="fin-kpi__value">${fmtMoney(totalVencido)}</span>
        <span class="fin-kpi__label">🔴 Vencidas (${vencidas.length})</span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(pagoNoMes)}</span>
        <span class="fin-kpi__label">Pago este mês</span>
      </div>`;

    document.getElementById("apagarCount").textContent = `(${contas.length})`;
    document.getElementById("apagarBody").innerHTML = contas.map((c) => {
      const dias = diasAteVencimento_(c.vencimento);
      const statusExibido = c.status === "Pendente" && dias !== null && dias < 0 ? "Vencida" : c.status;
      return `
      <tr>
        <td>${(c.vencimento || "").split("-").reverse().join("/")}</td>
        <td>${escapeHtml(c.descricao)}</td>
        <td>${escapeHtml(c.fornecedor || "-")}</td>
        <td>${escapeHtml(c.categoria || "-")}</td>
        <td>${escapeHtml(c.parcela || "-")}</td>
        <td class="num">${fmtMoney(c.valor)}</td>
        <td>${fmtStatusBadge_(statusExibido)}</td>
        <td>${c.status === "Pendente" ? `<button type="button" class="btn btn--ghost btn--icon acao-conta-pagar" data-id="${c.id}" data-acao="marcar_conta_pagar_paga" title="Marcar como pago">✓</button>` : ""}
          <button type="button" class="btn btn--ghost btn--icon acao-conta-pagar" data-id="${c.id}" data-acao="excluir_conta_pagar" title="Excluir">✕</button></td>
      </tr>`;
    }).join("");

    document.querySelectorAll(".acao-conta-pagar").forEach((btn) => {
      btn.addEventListener("click", () => executarAcaoConta_(btn.dataset.acao, btn.dataset.id, "contas_pagar"));
    });
  }

  document.getElementById("apagarForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cfg = loadConfig();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const resp = await fetch(cfg.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          token: cfg.apiToken, acao: "adicionar_conta_pagar",
          descricao: document.getElementById("apagarDescricao").value,
          fornecedor: document.getElementById("apagarFornecedor").value,
          categoria: document.getElementById("apagarCategoria").value,
          conta_pagamento: document.getElementById("apagarContaPagamento").value,
          valor_total: document.getElementById("apagarValorTotal").value,
          parcelas: document.getElementById("apagarParcelas").value,
          vencimento_primeira: document.getElementById("apagarVencimento").value,
        }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "erro");
      e.target.reset();
      document.getElementById("apagarParcelas").value = "1";
      fetchData();
    } catch (err) {
      alert("Não foi possível adicionar: " + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ----------------------------------------------------- Contas a Receber
  // Vendas do Mercado Livre que já aconteceram, mas o dinheiro ainda não
  // foi liberado — aparecem aqui automaticamente (não precisa cadastrar
  // nada), e desaparecem sozinhas quando o Mercado Livre libera (o status
  // muda, e nessa hora elas passam a contar no Caixa, não mais aqui).
  //
  // Só entra pagamento APROVADO: um pagamento reembolsado, cancelado ou
  // com chargeback nunca chega a ser "released" (o status de liberação
  // dele fica "pending" pra sempre) — antes, esses somavam no "Total a
  // receber" eternamente, e era por isso que o site mostrava um valor
  // MAIOR que o "a liberar" real do app do Mercado Pago.
  // Pagamento que conta como A RECEBER.
  //
  // Não é só "approved": o app do Mercado Pago inclui também o que está EM
  // MEDIAÇÃO — venda em disputa, dinheiro retido até resolver. Na conta 1
  // isso era R$ 169,76, exatamente a diferença entre o que o painel
  // mostrava e o total do app.
  //
  // É dinheiro seu, então entra. Mas vem marcado, porque depende de ganhar
  // a disputa.
  function contaComoReceber_(m) {
    const s = String(m.status || "").toLowerCase();
    return s === "approved" || s === "in_mediation";
  }
  function emMediacao_(m) {
    return String(m.status || "").toLowerCase() === "in_mediation";
  }

  function recebiveisAutomaticosML_() {
    return movimentosMpCombinados_()
      .filter((m) => m.origem === "Mercado Livre" && m.status_liberacao === "pending" && contaComoReceber_(m))
      .map((m) => ({
        id: "ml_" + m.pagamento_id,
        descricao: m.descricao || "Venda Mercado Livre",
        cliente: "Mercado Livre (conta " + m.contaMp + ")",
        categoria: "Receita Marketplace",
        valor: valorLiquidoEfetivo_(m),
        vencimento: m.data_liberacao || m.data || "",
        status: "A receber",
        automatico: true,
        contaMp: m.contaMp,
        mediacao: emMediacao_(m),
      }));
  }

  function renderAreceber() {
    const contas = (state.contas_receber || []).map((c) => ({ ...c, automatico: false }))
      .concat(recebiveisAutomaticosML_())
      .sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
    const pendentes = contas.filter((c) => c.status === "A receber");
    const totalPendente = pendentes.reduce((s, c) => s + Number(c.valor || 0), 0);
    const previsto7 = pendentes.filter((c) => { const d = diasAteVencimento_(c.vencimento); return d !== null && d >= 0 && d <= 7; })
      .reduce((s, c) => s + Number(c.valor || 0), 0);
    const atrasados = pendentes.filter((c) => { const d = diasAteVencimento_(c.vencimento); return d !== null && d < 0; });
    const totalAtrasado = atrasados.reduce((s, c) => s + Number(c.valor || 0), 0);
    const hojeIso = isoDate_(new Date());
    const recebidoNoMes = contas.filter((c) => c.status === "Recebido" && (c.data_recebimento || "").slice(0, 7) === hojeIso.slice(0, 7))
      .reduce((s, c) => s + Number(c.valor || 0), 0);

    // Quebra do total, pra dar pra CONFERIR com o app do Mercado Pago:
    // o app mostra o "a liberar" de UMA conta por vez, só do Mercado
    // Livre, sem as contas manuais — então compare cada pedaço com o app
    // da conta correspondente, não o total com um app só.
    const mlConta1 = pendentes.filter((c) => c.automatico && c.contaMp === "1").reduce((s, c) => s + Number(c.valor || 0), 0);
    const mlConta2 = pendentes.filter((c) => c.automatico && c.contaMp === "2").reduce((s, c) => s + Number(c.valor || 0), 0);
    const manuais = pendentes.filter((c) => !c.automatico).reduce((s, c) => s + Number(c.valor || 0), 0);

    document.getElementById("areceberKpiRow").innerHTML = `
      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">${fmtMoney(totalPendente)}</span>
        <span class="fin-kpi__label">Total a receber</span>
        <span class="muted" style="font-size:11px;">↳ ML conta 1: ${fmtMoney(mlConta1)} · ML conta 2: ${fmtMoney(mlConta2)} · manuais: ${fmtMoney(manuais)}</span>
      </div>
      <div class="fin-kpi">
        <span class="fin-kpi__value">${fmtMoney(previsto7)}</span>
        <span class="fin-kpi__label">Previsto nos próximos 7 dias</span>
      </div>
      <div class="fin-kpi ${totalAtrasado > 0 ? "fin-kpi--out" : ""}">
        <span class="fin-kpi__value">${fmtMoney(totalAtrasado)}</span>
        <span class="fin-kpi__label">🔴 Atrasados (${atrasados.length})</span>
      </div>
      <div class="fin-kpi fin-kpi--profit">
        <span class="fin-kpi__value">${fmtMoney(recebidoNoMes)}</span>
        <span class="fin-kpi__label">Recebido este mês</span>
      </div>`;

    document.getElementById("areceberCount").textContent = `(${contas.length})`;
    document.getElementById("areceberBody").innerHTML = contas.map((c) => {
      const dias = diasAteVencimento_(c.vencimento);
      const statusExibido = c.status === "A receber" && dias !== null && dias < 0 ? "Atrasado" : c.status;
      return `
      <tr>
        <td>${(c.vencimento || "").split("-").reverse().join("/")}</td>
        <td>${escapeHtml(c.descricao)}</td>
        <td>${escapeHtml(c.cliente || "-")}${c.automatico ? ` <span class="conta-badge conta-badge--1" style="width:auto;border-radius:10px;padding:1px 7px;font-size:9px;">auto</span>` : ""}</td>
        <td>${escapeHtml(c.categoria || "-")}</td>
        <td class="num">${fmtMoney(c.valor)}</td>
        <td>${fmtStatusBadge_(statusExibido)}</td>
        <td>${c.automatico ? `<span class="muted" style="font-size:11px;">liberação automática</span>` : `
          ${c.status === "A receber" ? `<button type="button" class="btn btn--ghost btn--icon acao-conta-receber" data-id="${c.id}" data-acao="marcar_conta_receber_recebida" title="Marcar como recebido">✓</button>` : ""}
          <button type="button" class="btn btn--ghost btn--icon acao-conta-receber" data-id="${c.id}" data-acao="excluir_conta_receber" title="Excluir">✕</button>`}</td>
      </tr>`;
    }).join("");

    document.querySelectorAll(".acao-conta-receber").forEach((btn) => {
      btn.addEventListener("click", () => executarAcaoConta_(btn.dataset.acao, btn.dataset.id, "contas_receber"));
    });
  }

  document.getElementById("areceberForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cfg = loadConfig();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const resp = await fetch(cfg.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          token: cfg.apiToken, acao: "adicionar_conta_receber",
          descricao: document.getElementById("areceberDescricao").value,
          cliente: document.getElementById("areceberCliente").value,
          categoria: document.getElementById("areceberCategoria").value,
          forma_recebimento: document.getElementById("areceberForma").value,
          conta_destino: document.getElementById("areceberContaDestino").value,
          valor: document.getElementById("areceberValor").value,
          vencimento: document.getElementById("areceberVencimento").value,
        }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "erro");
      e.target.reset();
      fetchData();
    } catch (err) {
      alert("Não foi possível adicionar: " + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // Ação genérica (marcar como pago/recebido, ou excluir) pras duas telas —
  // sempre busca os dados de novo no final, pra tudo (KPIs, tabela) ficar
  // consistente sem precisar duplicar a lógica de atualização local.
  async function executarAcaoConta_(acao, id, campoEstado) {
    if (acao.startsWith("excluir") && !confirm("Tem certeza que quer excluir esse lançamento?")) return;
    const cfg = loadConfig();
    try {
      const resp = await fetch(cfg.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: cfg.apiToken, acao, id }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "erro");
      fetchData();
    } catch (err) {
      alert("Não foi possível concluir: " + err.message);
    }
  }

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
    renderCapitalEmpresa_();
    renderDre_();
  }

  // ==================================================== POSIÇÃO FINANCEIRA
  //
  // Três telas separadas, de propósito, porque respondem perguntas
  // diferentes e misturá-las é o jeito clássico de somar a mesma coisa
  // duas vezes:
  //
  //   POSIÇÃO FINANCEIRA  "quanto temos?"      — foto patrimonial de hoje
  //   DRE / P&L           "quanto ganhamos?"   — resultado de um período
  //   FLUXO DE CAIXA      "quanto entrou/saiu?"— movimento de um período
  //
  // Esta parte é a POSIÇÃO. Ela não soma faturamento nem lucro: aqueles
  // são de outra tela.
  //
  // ---------------------------------------------------------------------
  // A REGRA QUE EVITA CONTAR DUAS VEZES
  //
  // Uma venda no Mercado Livre percorre este caminho:
  //
  //   venda no ML → a receber (pending no MP) → liberado → saldo no MP
  //
  // É o MESMO dinheiro mudando de estado, não três valores. Por isso:
  //
  //   DISPONÍVEL  = só o SALDO das contas do Mercado Pago
  //   A RECEBER   = só o que está "pending" no Mercado Pago
  //   nunca       = venda do Mercado Livre (ela já está num dos dois acima)
  //
  // Venda do ML entra na DRE, como resultado. Nunca na posição.
  //
  // ---------------------------------------------------------------------
  // DADO NÃO DISPONÍVEL ≠ R$ 0
  //
  // Zero quer dizer "não existe valor". Não disponível quer dizer "a
  // integração não entregou". São coisas diferentes e o painel nunca deve
  // confundir as duas — um zero inventado é pior que um buraco visível.
  //
  // Por isso todo componente carrega { valor, disponivel, origem, quando }.
  // Quando disponivel = false, a tela mostra o aviso, e o total que
  // depende dele também fica marcado como incompleto.

  function componente_(valor, origem, quando, extra) {
    return Object.assign({ valor: Number(valor || 0), disponivel: true, origem, quando: quando || null }, extra || {});
  }
  function indisponivel_(origem, motivo) {
    return { valor: 0, disponivel: false, origem, motivo, quando: null };
  }

  function fmtValor_(c) {
    return c.disponivel ? fmtMoney(c.valor) : "—";
  }
  function selo_(c) {
    if (!c.disponivel) return `<span class="badge badge--saida" title="${escapeHtml(c.motivo || "")}">⚠ não disponível</span>`;
    return `<span class="muted" style="font-size:11px;">${escapeHtml(c.origem)}${c.quando ? " · " + c.quando : ""}</span>`;
  }

  // ---- 1. DINHEIRO DISPONÍVEL (só saldo do Mercado Pago)
  function fpDisponivel_() {
    const saldo = Number(state.saldo_mp || 0);
    // Barreira contra número absurdo. Já aconteceu: uma coluna de DATA foi
    // lida como dinheiro e o caixa virou R$ 3,5 trilhões. Um número desses
    // num painel financeiro contamina tudo em volta — percentual,
    // patrimônio, alertas — e é pior que não ter número nenhum.
    if (!isFinite(saldo) || saldo < 0 || saldo > 1e11) {
      return indisponivel_("Mercado Pago",
        "O saldo veio com um valor impossível (" + saldo + "). Confira a aba Saldo MP na planilha.");
    }
    if (saldo > 0) {
      return componente_(saldo, "saldo das 2 contas do Mercado Pago", null, { contas: 2 });
    }
    // Sem saldo real não há como saber o disponível. Somar tudo que já foi
    // liberado seria mentira: dinheiro liberado sai da conta, e a aba de
    // movimentos só registra entrada.
    return indisponivel_("Mercado Pago",
      "A API de saldo responde 403 nas duas contas. Rode atualizarSaldoPorRelatorio na planilha " +
      "(ou preencha o saldo base na aba Saldo MP) pra este número existir.");
  }

  // ---- 2. A RECEBER (só o que está pending no Mercado Pago) + janelas
  function fpAReceber_() {
    const automaticos = recebiveisAutomaticosML_();
    const manuais = (state.contas_receber || []).filter((c) => c.status === "A receber");

    const hoje = isoDate_(new Date());
    const emDias = (n) => isoDate_(new Date(Date.now() + n * 86400000));
    const d7 = emDias(7), d30 = emDias(30);

    const balde = { vencido: 0, hoje: 0, ate7: 0, ate30: 0, depois: 0, semData: 0 };
    const somar = (venc, valor) => {
      if (!venc) { balde.semData += valor; return; }
      const v = String(venc).slice(0, 10);
      if (v < hoje) balde.vencido += valor;
      else if (v === hoje) balde.hoje += valor;
      else if (v <= d7) balde.ate7 += valor;
      else if (v <= d30) balde.ate30 += valor;
      else balde.depois += valor;
    };

    // Separa o que tem data pra cair do que está TRAVADO.
    //
    // Pagamento cuja data de liberação já passou e mesmo assim não liberou
    // não é "a receber" no mesmo sentido: é entrega não confirmada,
    // reclamação ou mediação. Pode não cair nunca. Somar os dois esconde um
    // problema de operação atrás de um número que parece saudável.
    let mp1 = 0, mp2 = 0, retido = 0, retidoItens = 0, mediacao = 0, mediacaoItens = 0;
    automaticos.forEach((r) => {
      const v = Number(r.valor || 0);
      if (r.mediacao) { mediacao += v; mediacaoItens++; }
      const venc = r.vencimento ? String(r.vencimento).slice(0, 10) : "";
      // Em mediação não vira "retido" mesmo com data vencida — é outra
      // situação: não é entrega parada, é disputa aberta.
      if (!r.mediacao && venc && venc < hoje) { retido += v; retidoItens++; return; }
      if (r.contaMp === "1") mp1 += v; else mp2 += v;
      somar(r.vencimento, v);
    });
    let outros = 0;
    manuais.forEach((c) => { const v = Number(c.valor || 0); outros += v; somar(c.vencimento, v); });

    const total = mp1 + mp2 + outros;
    return componente_(total, "Mercado Pago · aprovado, com data pra liberar", null,
      { mp1, mp2, outros, balde, retido, retidoItens, mediacao, mediacaoItens,
        itens: automaticos.length + manuais.length });
  }

  // ---- 3. ESTOQUE a custo
  function fpEstoque_() {
    const porContaSku = new Map();
    (state.linhasProdutosPorConta || []).forEach((p) => {
      const chave = p.conta + "|" + p.sku;
      const a = porContaSku.get(chave) || {
        conta: p.conta, sku: p.sku, titulo: p.titulo, estoque: 0, custo: 0,
        ativo: false, qtd30: 0, ultimaVenda: null,
      };
      a.estoque = Math.max(a.estoque, Number(p.estoque || 0));
      a.custo = Math.max(a.custo, Number(p.custo || 0));
      a.qtd30 += Number(p.qtd30 || 0);
      if (!p.inativo) a.ativo = true;
      if (p.ultimaVenda && (!a.ultimaVenda || p.ultimaVenda > a.ultimaVenda)) a.ultimaVenda = p.ultimaVenda;
      porContaSku.set(chave, a);
    });

    let total = 0, unidades = 0, anuncios = 0, foraDoAr = 0, foraDoArUn = 0;
    let semCusto = 0, unidadesSemCusto = 0, parado = 0, semGiro = 0, critico = 0;
    const skus = new Set();
    const semCustoLista = [], paradoLista = [];
    const limite90 = isoDate_(new Date(Date.now() - 90 * 86400000));

    porContaSku.forEach((v) => {
      if (v.estoque <= 0) return;
      skus.add(v.sku);
      if (v.custo <= 0) { semCusto++; unidadesSemCusto += v.estoque; semCustoLista.push(v); return; }

      const valor = v.estoque * v.custo;

      // ANÚNCIO EXCLUÍDO NÃO É CAPITAL. O Mercado Livre continua devolvendo
      // estoque pra anúncio que saiu do ar, mas é resíduo de anúncio morto,
      // não peça no depósito. Na conta 1 eram 2.518 unidades assim, 97% do
      // total — contar isso seria inventar quase três mil peças.
      if (!v.ativo) {
        foraDoAr += valor;
        foraDoArUn += v.estoque;
        return;
      }

      total += valor;
      unidades += v.estoque;
      anuncios++;

      // Parado: nada vendido em 90 dias (ou nunca vendeu)
      if (!v.ultimaVenda || v.ultimaVenda < limite90) { parado += valor; paradoLista.push(v); }
      if (v.qtd30 === 0) semGiro++;
      // Crítico: gira, mas o estoque acaba em menos de 7 dias
      const porDia = v.qtd30 / 30;
      if (porDia > 0 && v.estoque / porDia < 7) critico++;
    });

    semCustoLista.sort((a, b) => b.estoque - a.estoque);
    paradoLista.sort((a, b) => (b.estoque * b.custo) - (a.estoque * a.custo));

    return componente_(total, "Mercado Livre · anúncio no ar × custo", null, {
      unidades, anuncios, skus: skus.size, foraDoAr, foraDoArUn, parado, semGiro, critico,
      semCusto, unidadesSemCusto, semCustoLista, paradoLista,
    });
  }

  // ---- 4. CONTAS A PAGAR + janelas
  function fpAPagar_() {
    const pendentes = (state.contas_pagar || []).filter((c) => c.status !== "Pago");
    if (!(state.contas_pagar || []).length) {
      return Object.assign(indisponivel_("Contas a pagar",
        "Nenhuma conta lançada ainda. É o único bloco que depende de lançamento manual — " +
        "não existe API que saiba dos seus fornecedores, impostos e aluguel."),
        { balde: { vencido: 0, hoje: 0, ate7: 0, ate30: 0, depois: 0, semData: 0 }, porCategoria: {} });
    }

    const hoje = isoDate_(new Date());
    const emDias = (n) => isoDate_(new Date(Date.now() + n * 86400000));
    const d7 = emDias(7), d30 = emDias(30);
    const balde = { vencido: 0, hoje: 0, ate7: 0, ate30: 0, depois: 0, semData: 0 };
    const porCategoria = {};

    let total = 0;
    pendentes.forEach((c) => {
      const v = Number(c.valor || 0);
      total += v;
      const cat = c.categoria || "Sem categoria";
      porCategoria[cat] = (porCategoria[cat] || 0) + v;
      const venc = c.vencimento ? String(c.vencimento).slice(0, 10) : "";
      if (!venc) balde.semData += v;
      else if (venc < hoje) balde.vencido += v;
      else if (venc === hoje) balde.hoje += v;
      else if (venc <= d7) balde.ate7 += v;
      else if (venc <= d30) balde.ate30 += v;
      else balde.depois += v;
    });

    return componente_(total, "lançamentos manuais · aba ContasAPagar", null,
      { balde, porCategoria, itens: pendentes.length });
  }

  // ---- BALANÇO: ativos, passivos, patrimônio líquido
  function fpBalanco_() {
    const disponivel = fpDisponivel_();
    const aReceber = fpAReceber_();
    const estoque = fpEstoque_();
    const aPagar = fpAPagar_();

    const ativosComp = [disponivel, aReceber, estoque];
    const passivosComp = [aPagar];

    const ativos = ativosComp.reduce((s, c) => s + (c.disponivel ? c.valor : 0), 0);
    const passivos = passivosComp.reduce((s, c) => s + (c.disponivel ? c.valor : 0), 0);

    // Se algum pedaço não veio, o total existe mas está INCOMPLETO — e isso
    // precisa aparecer, senão o gestor lê como se fosse o número fechado.
    const faltando = ativosComp.concat(passivosComp).filter((c) => !c.disponivel);

    return {
      disponivel, aReceber, estoque, aPagar,
      ativos, passivos, patrimonio: ativos - passivos,
      completo: faltando.length === 0,
      faltando: faltando.map((c) => c.origem),

      // CAPITAL DE GIRO olha só os próximos 30 DIAS, não o passivo inteiro.
      //
      // Motivo: dívida parcelada não vence toda hoje. Um empréstimo em 9x
      // aparece no passivo pelo valor cheio — e está certo, você deve tudo
      // aquilo — mas comparar o total com o caixa de hoje responde a
      // pergunta errada. A pergunta útil é: o que vence nos próximos 30
      // dias cabe no que eu tenho mais o que entra nos próximos 30 dias?
      //
      // Antes, os R$ 15 mil de um empréstimo de 9 meses eram descontados
      // como se vencessem amanhã. O giro parecia negativo sem motivo.
      curtoPrazo: aPagar.disponivel
        ? aPagar.balde.vencido + aPagar.balde.hoje + aPagar.balde.ate7 + aPagar.balde.ate30
        : 0,
      longoPrazo: aPagar.disponivel ? aPagar.balde.depois : 0,
      entra30: aReceber.disponivel
        ? aReceber.balde.hoje + aReceber.balde.ate7 + aReceber.balde.ate30
        : 0,
      giro: (disponivel.disponivel ? disponivel.valor : 0)
          + (aReceber.disponivel ? (aReceber.balde.hoje + aReceber.balde.ate7 + aReceber.balde.ate30) : 0)
          - (aPagar.disponivel ? (aPagar.balde.vencido + aPagar.balde.hoje + aPagar.balde.ate7 + aPagar.balde.ate30) : 0),
    };
  }

  // ---- RECONCILIAÇÃO Mercado Livre × Mercado Pago
  //
  // Compara o que o ML diz que vendeu com o que apareceu no Mercado Pago,
  // pelo número do pedido. Diferença esperada existe (comissão, frete), o
  // que interessa é pedido que NÃO apareceu no MP de jeito nenhum.
  function fpReconciliacao_(dias) {
    const janela = isoDate_(new Date(Date.now() - (dias || 30) * 86400000));
    const vendas = (state.transacoes || []).concat(state.transacoes_2 || [])
      .filter((t) => (t.data || "") >= janela);

    const porPedido = new Map();
    vendas.forEach((t) => {
      const id = String(t.pedido_id || "");
      if (!id) return;
      porPedido.set(id, (porPedido.get(id) || 0) + Number(t.faturamento || 0));
    });

    const noMp = new Set();
    let recebidoMp = 0;
    movimentosMpCombinados_().forEach((m) => {
      if (!pagamentoAprovado_(m)) return;
      const id = String(m.pedido_ml || "");
      if (!id || !porPedido.has(id)) return;
      noMp.add(id);
      recebidoMp += valorLiquidoEfetivo_(m);
    });

    const semCorrespondencia = [];
    let faturadoMl = 0, faturadoSemMp = 0;
    porPedido.forEach((valor, id) => {
      faturadoMl += valor;
      if (!noMp.has(id)) { semCorrespondencia.push(id); faturadoSemMp += valor; }
    });

    const pedidos = porPedido.size;
    const cobertura = pedidos ? noMp.size / pedidos : 1;
    return {
      dias: dias || 30, pedidos, casados: noMp.size, semCorrespondencia: semCorrespondencia.length,
      faturadoMl, recebidoMp, faturadoSemMp, cobertura,
      // Só acusa divergência quando pedido nenhum apareceu no MP — a
      // diferença de VALOR é normal (é a comissão do ML e o frete).
      ok: cobertura >= 0.95,
    };
  }

  // ---- ALERTAS
  function fpAlertas_(b) {
    const a = [];
    const add = (nivel, texto) => a.push({ nivel, texto });

    if (!b.disponivel.disponivel) {
      add("vermelho", "Saldo do Mercado Pago não disponível pela API — o disponível não pode ser calculado.");
    } else {
      // Compara o que VENCE em 30 dias, não o passivo inteiro. Dívida
      // parcelada não é problema de liquidez só por ser grande.
      const cobre = b.disponivel.valor + b.entra30;
      if (b.aPagar.disponivel && b.curtoPrazo > cobre) {
        add("laranja", `Vence ${fmtMoney(b.curtoPrazo)} nos próximos 30 dias, e você tem ${fmtMoney(cobre)} entre caixa e recebíveis do período.`);
      }
      if (b.aPagar.disponivel && b.aPagar.balde.vencido > 0) {
        add("vermelho", `${fmtMoney(b.aPagar.balde.vencido)} em contas VENCIDAS.`);
      }
    }

    if (b.estoque.semCusto > 0) {
      add("amarelo", `${b.estoque.semCusto} anúncio(s) com ${fmtNum(b.estoque.unidadesSemCusto)} unidades sem custo cadastrado — ficam fora do valor do estoque.`);
    }
    if (b.estoque.parado > 0) {
      const pct = b.estoque.valor > 0 ? b.estoque.parado / b.estoque.valor : 0;
      add(pct > 0.4 ? "laranja" : "amarelo",
        `${fmtMoney(b.estoque.parado)} (${fmtPct(pct)}) em estoque sem venda há mais de 90 dias.`);
    }
    if (b.estoque.critico > 0) {
      add("amarelo", `${b.estoque.critico} produto(s) com estoque para menos de 7 dias no ritmo atual.`);
    }
    if (b.ativos > 0 && b.estoque.disponivel && b.estoque.valor / b.ativos > 0.7) {
      add("laranja", `${fmtPct(b.estoque.valor / b.ativos)} do ativo está preso em estoque.`);
    }
    if (!b.aPagar.disponivel) {
      add("amarelo", "Contas a pagar sem lançamentos — o passivo e o patrimônio líquido estão incompletos.");
    }

    if (b.aReceber.mediacao > 0) {
      add("laranja", `${fmtMoney(b.aReceber.mediacao)} em ${b.aReceber.mediacaoItens} venda(s) em mediação — está contado no a receber, mas depende de ganhar a disputa.`);
    }
    if (b.aReceber.retido > 0) {
      add("laranja", `${fmtMoney(b.aReceber.retido)} em ${b.aReceber.retidoItens} pagamento(s) passaram da data de liberação e não caíram — entrega não confirmada, reclamação ou mediação.`);
    }

    // A pergunta que decide se uma dívida parcelada é sustentável não é
    // "quanto devo", é "a parcela cabe no que eu ganho por mês".
    if (b.aPagar.disponivel && b.curtoPrazo > 0) {
      const d30 = calcularDre_({ modo: "30d", valor: "" });
      if (d30.lucro > 0) {
        const folga = d30.lucro - b.curtoPrazo;
        add(folga >= 0 ? "amarelo" : "vermelho",
          folga >= 0
            ? `A parcela do mês (${fmtMoney(b.curtoPrazo)}) cabe no lucro dos últimos 30 dias (${fmtMoney(d30.lucro)}) — sobram ${fmtMoney(folga)}.`
            : `A parcela do mês (${fmtMoney(b.curtoPrazo)}) é maior que o lucro dos últimos 30 dias (${fmtMoney(d30.lucro)}). Faltam ${fmtMoney(-folga)} por mês.`);
      }
    }

    const rec = fpReconciliacao_(30);
    if (!rec.ok) {
      add("vermelho", `${rec.semCorrespondencia} de ${rec.pedidos} pedidos dos últimos 30 dias não apareceram no Mercado Pago (${fmtMoney(rec.faturadoSemMp)}).`);
    }
    return { lista: a, reconciliacao: rec };
  }

  // ---------------------------------------------------------------- RENDER

  function renderCapitalEmpresa_() {
    const container = garantirContainerCapital_();
    if (!container) return;

    const b = fpBalanco_();
    const { lista: alertas, reconciliacao: rec } = fpAlertas_(b);
    const totalOnde = (b.disponivel.disponivel ? b.disponivel.valor : 0)
                    + (b.aReceber.disponivel ? b.aReceber.valor : 0)
                    + (b.estoque.disponivel ? b.estoque.valor : 0);
    const onde = (v) => (totalOnde > 0 ? v / totalOnde : 0);

    const cor = { vermelho: "#FF6B9D", laranja: "#FFA857", amarelo: "#FFD166" };

    container.innerHTML = `
      <div style="grid-column:1/-1;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">
        <h2 style="margin:0;font-size:17px;font-weight:600;">Posição financeira</h2>
        <span class="muted" style="font-size:12px;">o que a empresa tem hoje · não é resultado do período</span>
        <span style="flex:1;"></span>
        ${b.completo
          ? `<span class="badge badge--manutencao">🟢 todos os blocos disponíveis</span>`
          : `<span class="badge badge--saida">⚠ incompleto: ${escapeHtml(b.faltando.join(" · "))}</span>`}
      </div>

      <div class="fin-kpi ${b.disponivel.disponivel ? "fin-kpi--in" : "fin-kpi--out"}">
        <span class="fin-kpi__value">💰 ${fmtValor_(b.disponivel)}</span>
        <span class="fin-kpi__label">Disponível</span>
        ${selo_(b.disponivel)}
      </div>

      <div class="fin-kpi fin-kpi--in">
        <span class="fin-kpi__value">💳 ${fmtValor_(b.aReceber)}</span>
        <span class="fin-kpi__label">A receber</span>
        <span class="muted" style="font-size:11px;">
          MP1 ${fmtMoney(b.aReceber.mp1)} · MP2 ${fmtMoney(b.aReceber.mp2)}${b.aReceber.outros > 0 ? " · outros " + fmtMoney(b.aReceber.outros) : ""}<br>
          7d ${fmtMoney(b.aReceber.balde.hoje + b.aReceber.balde.ate7)} · 30d ${fmtMoney(b.aReceber.balde.ate30)} · depois ${fmtMoney(b.aReceber.balde.depois)}
          ${b.aReceber.retido > 0 ? `<br><span style="color:#FFA857;">⚠ ${fmtMoney(b.aReceber.retido)} retido em ${b.aReceber.retidoItens} pagamento(s) — passou da data e não caiu</span>` : ""}
          ${b.aReceber.mediacao > 0 ? `<br><span style="color:#FFA857;">⚠ ${fmtMoney(b.aReceber.mediacao)} em ${b.aReceber.mediacaoItens} venda(s) em disputa</span>` : ""}
        </span>
      </div>

      <div class="fin-kpi">
        <span class="fin-kpi__value">📦 ${fmtValor_(b.estoque)}</span>
        <span class="fin-kpi__label">Estoque <span class="muted">a custo</span></span>
        <span class="muted" style="font-size:11px;">
          ${fmtNum(b.estoque.unidades)} un · ${b.estoque.skus} SKU · ${b.estoque.anuncios} anúncio(s)
          ${b.estoque.semCusto > 0 ? `<br>⚠ ${b.estoque.semCusto} sem custo, fora da conta` : ""}
          ${b.estoque.foraDoArUn > 0 ? `<br>${fmtNum(b.estoque.foraDoArUn)} un em anúncio excluído — fora da conta` : ""}
        </span>
      </div>

      <div class="fin-kpi ${b.aPagar.disponivel && b.aPagar.valor > 0 ? "fin-kpi--out" : ""}">
        <span class="fin-kpi__value">🔴 ${fmtValor_(b.aPagar)}</span>
        <span class="fin-kpi__label">A pagar</span>
        ${b.aPagar.disponivel ? `<span class="muted" style="font-size:11px;">
          vencido ${fmtMoney(b.aPagar.balde.vencido)} · 7d ${fmtMoney(b.aPagar.balde.hoje + b.aPagar.balde.ate7)} · 30d ${fmtMoney(b.aPagar.balde.ate30)}
        </span>` : selo_(b.aPagar)}
      </div>

      <div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;
                  padding:14px 16px;background:rgba(255,255,255,0.03);border-radius:12px;">
        <div>
          <div class="muted" style="font-size:11px;">🏦 TOTAL DE ATIVOS</div>
          <div style="font-size:20px;font-weight:600;">${fmtMoney(b.ativos)}</div>
          <div class="muted" style="font-size:11px;">disponível + a receber + estoque</div>
        </div>
        <div>
          <div class="muted" style="font-size:11px;">🔴 TOTAL DE PASSIVOS</div>
          <div style="font-size:20px;font-weight:600;">${b.aPagar.disponivel ? fmtMoney(b.passivos) : "—"}</div>
          <div class="muted" style="font-size:11px;">
            ${fmtMoney(b.curtoPrazo)} em até 30 dias<br>
            ${fmtMoney(b.longoPrazo)} parcelado adiante
          </div>
        </div>
        <div>
          <div class="muted" style="font-size:11px;">💎 PATRIMÔNIO LÍQUIDO</div>
          <div style="font-size:22px;font-weight:700;color:${b.patrimonio >= 0 ? "#5BE49B" : "#FF6B9D"};">
            ${fmtMoney(b.patrimonio)}</div>
          <div class="muted" style="font-size:11px;">ativos − passivos${b.completo ? "" : " · incompleto"}
            ${b.longoPrazo > 0 ? `<br>inclui ${fmtMoney(b.longoPrazo)} que só vence adiante` : ""}</div>
        </div>
        <div>
          <div class="muted" style="font-size:11px;">⚙ FOLGA EM 30 DIAS</div>
          <div style="font-size:20px;font-weight:600;color:${b.giro >= 0 ? "#5BE49B" : "#FF6B9D"};">
            ${b.disponivel.disponivel || b.aReceber.disponivel ? fmtMoney(b.giro) : "—"}</div>
          <div class="muted" style="font-size:11px;">
            entra ${fmtMoney(b.entra30)} · vence ${fmtMoney(b.curtoPrazo)}<br>
            ${b.longoPrazo > 0 ? fmtMoney(b.longoPrazo) + " só depois de 30 dias" : "nada além de 30 dias"}
          </div>
        </div>
      </div>

      <div style="grid-column:1/-1;padding:14px 16px;background:rgba(255,255,255,0.03);border-radius:12px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;">Onde está o dinheiro?</div>
        ${[
          { icone: "🏦", nome: "Caixa / Mercado Pago", c: b.disponivel, cor: "#5BE49B" },
          { icone: "💳", nome: "A receber", c: b.aReceber, cor: "#5B9CFF" },
          { icone: "📦", nome: "Estoque", c: b.estoque, cor: "#FFA857" },
        ].map((l) => {
          const p = l.c.disponivel ? onde(l.c.valor) : 0;
          return `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px;">
              <span style="width:190px;font-size:13px;">${l.icone} ${l.nome}</span>
              <span style="width:110px;text-align:right;font-size:13px;font-weight:600;">${fmtValor_(l.c)}</span>
              <span style="flex:1;height:9px;background:rgba(255,255,255,0.07);border-radius:5px;overflow:hidden;">
                <span style="display:block;height:100%;width:${(p * 100).toFixed(1)}%;background:${l.cor};"></span>
              </span>
              <span style="width:52px;text-align:right;font-size:12px;" class="muted">${l.c.disponivel ? fmtPct(p) : "—"}</span>
            </div>`;
        }).join("")}
        <div style="display:flex;gap:10px;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,0.08);">
          <span style="width:190px;font-size:13px;font-weight:600;">TOTAL</span>
          <span style="width:110px;text-align:right;font-size:13px;font-weight:700;">${fmtMoney(totalOnde)}</span>
          <span style="flex:1;"></span>
        </div>
      </div>

      <div style="grid-column:1/-1;display:flex;gap:16px;flex-wrap:wrap;font-size:12px;padding:0 4px;">
        <span>${rec.ok ? "🟢 CONCILIADO" : "🔴 DIVERGÊNCIA"}</span>
        <span class="muted">${rec.casados}/${rec.pedidos} pedidos dos últimos ${rec.dias} dias apareceram no Mercado Pago</span>
        <span class="muted">ML ${fmtMoney(rec.faturadoMl)} → MP ${fmtMoney(rec.recebidoMp)} (a diferença é comissão e frete)</span>
      </div>

      ${alertas.length ? `
        <div style="grid-column:1/-1;padding:12px 16px;border-radius:12px;background:rgba(255,255,255,0.03);">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Alertas</div>
          ${alertas.map((a) => `
            <div style="font-size:12px;line-height:1.7;">
              <span style="color:${cor[a.nivel]};">●</span> ${a.texto}
            </div>`).join("")}
        </div>` : ""}
    `;
  }

  // Se o HTML não tiver o container, cria um logo abaixo das métricas do
  // topo. Assim o painel aparece sem precisar editar o index.html.
  function garantirContainerCapital_() {
    let el = document.getElementById("capitalEmpresaRow");
    if (el) return el;
    const ancora = document.getElementById("metricasChaveHoje") || document.getElementById("dashboard");
    if (!ancora) return null;
    el = document.createElement("div");
    el.id = "capitalEmpresaRow";
    el.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:24px 0 8px;";
    ancora.parentNode.insertBefore(el, ancora.nextSibling);
    return el;
  }


  // ============================================================ DRE / P&L
  //
  // Tela SEPARADA da posição financeira, e essa separação é o ponto.
  //
  // A posição responde "quanto temos?" — é uma foto do patrimônio hoje.
  // O DRE responde "quanto ganhamos?" — é um filme de um período.
  //
  // Misturar os dois é o erro clássico: faturamento não é ativo, e estoque
  // não é receita. Somar venda com saldo conta o mesmo dinheiro duas vezes,
  // porque a venda VIRA saldo depois de liberada.
  //
  // Aqui o período faz todo sentido (é um intervalo de tempo), enquanto na
  // posição não faria nenhum (não existe registro do estoque de março).
  //
  // A conta vem da RAW_Vendas, que é a regra da casa:
  //     Lucro = Faturamento − Custo − Taxa ML − Frete

  function periodoDre_() {
    return state.capitalPeriodo || { modo: "mes", valor: isoDate_(new Date()).slice(0, 7) };
  }

  function mesesComVenda_() {
    const set = new Set();
    (state.transacoes || []).concat(state.transacoes_2 || []).forEach((t) => {
      if (t.data) set.add(String(t.data).slice(0, 7));
    });
    return Array.from(set).sort().reverse();
  }

  function intervaloDoPeriodo_(p) {
    const hoje = new Date();
    const iso = (d) => isoDate_(d);
    const menos = (n) => { const d = new Date(hoje); d.setDate(d.getDate() - n); return d; };

    if (p.modo === "hoje")  return { de: iso(hoje), ate: iso(hoje), rotulo: "hoje" };
    if (p.modo === "ontem") { const o = menos(1); return { de: iso(o), ate: iso(o), rotulo: "ontem" }; }
    if (p.modo === "7d")    return { de: iso(menos(6)), ate: iso(hoje), rotulo: "últimos 7 dias" };
    if (p.modo === "30d")   return { de: iso(menos(29)), ate: iso(hoje), rotulo: "últimos 30 dias" };
    if (p.modo === "dia")   return { de: p.valor, ate: p.valor, rotulo: p.valor.split("-").reverse().join("/") };
    if (p.modo === "mes") {
      const m = p.valor || iso(hoje).slice(0, 7);
      return { de: m + "-01", ate: m + "-31", rotulo: fmtMesLabel_(m + "-01") };
    }
    return { de: iso(menos(29)), ate: iso(hoje), rotulo: "últimos 30 dias" };
  }

  function calcularDre_(p) {
    const { de, ate, rotulo } = intervaloDoPeriodo_(p);
    const todas = (state.transacoes || []).concat(state.transacoes_2 || []);
    const doPeriodo = todas.filter((t) => {
      const d = String(t.data || "");
      return d >= de && d <= ate;
    });

    let faturamento = 0, custo = 0, taxa = 0, frete = 0, unidades = 0;
    const pedidos = new Set();
    doPeriodo.forEach((t) => {
      faturamento += Number(t.faturamento || 0);
      custo += Number(t.custo || 0);
      taxa += Number(t.taxa_ml || 0);
      frete += Number(t.frete || 0);
      unidades += Number(t.quantidade || 0);
      if (t.pedido_id) pedidos.add(t.pedido_id);
    });

    // Devoluções do mesmo período — dinheiro que voltou pro comprador
    const devolvido = (state.devolucoes || []).concat(state.devolucoes_2 || [])
      .filter((d) => { const x = String(d.data || ""); return x >= de && x <= ate; })
      .reduce((s, d) => s + Number(d.valor_reembolsado || 0), 0);

    const lucro = faturamento - custo - taxa - frete;
    return {
      rotulo, de, ate, faturamento, custo, taxa, frete, lucro, devolvido, unidades,
      pedidos: pedidos.size,
      margem: faturamento > 0 ? lucro / faturamento : 0,
      ticket: pedidos.size > 0 ? faturamento / pedidos.size : 0,
      lucroLiquido: lucro - devolvido,
    };
  }

  function renderDre_() {
    const el = garantirContainerDre_();
    if (!el) return;

    const p = periodoDre_();
    const d = calcularDre_(p);
    const meses = mesesComVenda_();
    const hojeIso = isoDate_(new Date());
    const linha = (rotulo, valor, nota, forte) => `
      <div style="display:flex;align-items:baseline;gap:10px;padding:5px 0;${forte ? "border-top:1px solid rgba(255,255,255,0.1);margin-top:4px;" : ""}">
        <span style="flex:1;font-size:13px;${forte ? "font-weight:600;" : ""}">${rotulo}</span>
        <span style="width:130px;text-align:right;font-size:13px;${forte ? "font-weight:700;" : ""}">${valor}</span>
        <span style="width:170px;font-size:11px;" class="muted">${nota || ""}</span>
      </div>`;

    el.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
        <h2 style="margin:0;font-size:17px;font-weight:600;">📈 DRE · resultado</h2>
        <span class="muted" style="font-size:12px;">quanto a operação ganhou — não é patrimônio</span>
        <span style="flex:1;"></span>
        <select id="dreModo" class="search-input" style="min-width:145px;">
          ${[["hoje","Hoje"],["ontem","Ontem"],["7d","Últimos 7 dias"],["30d","Últimos 30 dias"],["mes","Por mês"],["dia","Dia específico"]]
            .map(([v,t]) => `<option value="${v}" ${p.modo === v ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        ${p.modo === "mes" ? `<select id="dreValor" class="search-input" style="min-width:150px;">
          ${meses.map((m) => `<option value="${m}" ${m === p.valor ? "selected" : ""}>${fmtMesLabel_(m + "-01")}</option>`).join("")}
        </select>` : ""}
        ${p.modo === "dia" ? `<input type="date" id="dreValor" class="search-input" value="${p.valor || hojeIso}" max="${hojeIso}">` : ""}
      </div>

      <div style="padding:14px 16px;background:rgba(255,255,255,0.03);border-radius:12px;">
        <div class="muted" style="font-size:11px;margin-bottom:8px;">${escapeHtml(d.rotulo)} · ${fmtNum(d.pedidos)} pedidos · ${fmtNum(d.unidades)} unidades</div>
        ${linha("Faturamento bruto", fmtMoney(d.faturamento), "venda no Mercado Livre")}
        ${linha("(−) Custo do produto", fmtMoney(-d.custo), "aba Custos")}
        ${linha("(−) Comissão Mercado Livre", fmtMoney(-d.taxa), "cobrada por venda")}
        ${linha("(−) Frete", fmtMoney(-d.frete), "quando é por sua conta")}
        ${linha("= Lucro operacional", fmtMoney(d.lucro), fmtPct(d.margem) + " de margem", true)}
        ${d.devolvido > 0 ? linha("(−) Devoluções", fmtMoney(-d.devolvido), "reembolsado ao comprador") : ""}
        ${d.devolvido > 0 ? linha("= Lucro líquido", fmtMoney(d.lucroLiquido), "já sem devoluções", true) : ""}
        <div style="display:flex;gap:22px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);font-size:12px;">
          <span><strong>${fmtMoney(d.ticket)}</strong> <span class="muted">ticket médio</span></span>
          <span><strong>${fmtPct(d.margem)}</strong> <span class="muted">margem</span></span>
          <span class="muted">${d.lucro >= 0 ? "🟢 operação lucrativa no período" : "🔴 prejuízo no período"}</span>
        </div>
      </div>
    `;

    const selModo = document.getElementById("dreModo");
    if (selModo) selModo.addEventListener("change", () => {
      const modo = selModo.value;
      const ms = mesesComVenda_();
      state.capitalPeriodo = {
        modo,
        valor: modo === "mes" ? (ms[0] || hojeIso.slice(0, 7)) : modo === "dia" ? hojeIso : "",
      };
      renderDre_();
    });
    const selValor = document.getElementById("dreValor");
    if (selValor) selValor.addEventListener("change", () => {
      state.capitalPeriodo = { modo: p.modo, valor: selValor.value };
      renderDre_();
    });
  }

  function garantirContainerDre_() {
    let el = document.getElementById("dreRow");
    if (el) return el;
    const ancora = document.getElementById("capitalEmpresaRow");
    if (!ancora) return null;
    el = document.createElement("div");
    el.id = "dreRow";
    el.style.cssText = "margin:26px 0 8px;";
    ancora.parentNode.insertBefore(el, ancora.nextSibling);
    return el;
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
