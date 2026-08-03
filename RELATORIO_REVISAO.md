# Revisão geral do painel — o que foi encontrado e corrigido

Data desta revisão: com base na sessão atual, cobrindo `Codigo.gs`, `WebApp.gs`,
`PainelBuilder.gs`, `app.js`, `index.html` e `style.css`.

---

## 1. Estoque — contagem incorreta e atualização lenta

**Causa raiz:** para quem usa Mercado Envios Full, o campo `available_quantity`
que vem do endpoint `/items` do Mercado Livre pode ficar defasado ou não
refletir o estoque real do armazém Full — é uma causa comum e documentada de
"o estoque não bate". O sistema confiava só nesse campo.

**Correção:** `getEstoqueFull_()` (antiga `getReservaFull_()`) agora também lê
o `available_quantity` retornado pelo endpoint de inventário do Full
(`/inventories/{id}/stock/fulfillment`), e esse valor passa a ser a fonte
prioritária de estoque para itens Full — mais confiável que o campo de
`/items`. Itens com variação continuam somando cada variação, como antes.

**Atualização mais rápida:** antes, o estoque só era atualizado 1x por dia
(pela sincronização completa do catálogo, às 2h). Criei uma sincronização
**leve** só de estoque (`sincronizarEstoqueRapido`) que não busca foto,
categoria nem preço — só a quantidade — e por isso pode rodar a cada 15
minutos sem pesar no sistema. A sincronização completa (título, foto,
categoria, preço) continua 1x/dia, porque essa sim é naturalmente mais lenta.

**Ação necessária:** rode `criarGatilhosDiarios()` de novo no editor do Apps
Script, pra criar o novo gatilho de 15 em 15 min (gatilhos antigos não somem
sozinhos quando uma função nova é adicionada ao código).

---

## 2. "Valor de venda potencial" com valor ilógico

**Causa raiz:** o lucro potencial do estoque parado usava a margem
**histórica de 12 meses** (`Lucro 12M ÷ Faturamento 12M`) de cada produto.
Para produtos com pouco histórico de venda (1-2 vendas, ou um frete caro
pontual), essa margem podia sair em valores sem sentido — negativa, ou acima
de 100% — e ao multiplicar por todo o valor do estoque parado, o resultado
virava um número completamente fora da realidade.

**Correção:** o cálculo agora usa a margem simples e sempre coerente entre o
**preço de venda atual** e o **custo atual** do produto
(`(preço − custo) ÷ preço`) — não depende de quantas vendas o produto já
teve, então nunca produz percentuais absurdos. Isso muda só a coluna
"Margem" e "Lucro potencial" da aba Estoque; a margem histórica de 12 meses
continua sendo usada normalmente na Curva ABC e na tabela de produtos, onde
faz sentido (é uma medida de resultado já realizado, não uma projeção).

---

## 3. Financeiro — agora navegável por mês (mês fechado + diário do mês)

**Antes:** "Mensal" somava os últimos 12 meses inteiros num total só; "Diário"
somava os últimos 30 dias inteiros num total só. Não existia como escolher
"quero ver junho".

**Agora:** um seletor de mês foi adicionado ao topo do painel Financeiro.
Escolhendo um mês:
- Os cards (Faturamento, Saídas, Lucro líquido, Margem) mostram **só aquele
  mês**, calculado diretamente do histórico completo de vendas — não fica
  limitado à janela rolante das abas auxiliares.
- No modo **Diário**, o gráfico mostra **cada dia daquele mês** (todos os
  dias, mesmo os sem venda) — não mais os últimos 30 dias fixos.
- No modo **Mensal**, o gráfico compara o mês escolhido com o mês anterior.

**Limitação conhecida (documentada, não corrigida agora):** o "Gasto Ads" é
digitado manualmente na planilha e só existe de verdade dentro da janela
rolante de 12 meses de "Financeiro Mensal" / 30 dias de "Financeiro Diário".
Pra um mês fora dessas janelas, o sistema mostra Ads = 0 e avisa na tela
("ads não contabilizado — mês fora da janela salva"). **Recomendação para o
próximo ciclo:** criar uma aba separada e permanente de "Gasto Ads por dia"
(Data + Valor, sem limite de linhas), pra esse dado nunca mais se perder
conforme o tempo passa — hoje ele é literalmente descartado quando o dia sai
da janela de 30/12 dias.

---

## 4. Comparação de meses puxando dados errados

**Causa raiz (confirmada):** o seletor de "Comparativo de meses" usava a
**posição no array** (0 a 11) como valor de cada opção, e só preenchia as
opções **uma vez** (dado que a lista sempre tem 12 meses, a trava "só populo
se o tamanho mudou" nunca disparava de novo). Como "Financeiro Mensal" é uma
janela **rolante** — o mês mais antigo sai e um novo entra com o tempo — o
rótulo mostrado no seletor (ex: "jun/25") ficava congelado, enquanto o índice
selecionado passava a apontar pra um mês **diferente** do que estava escrito
na tela. Resultado: comparação com dados de um mês errado.

**Correção:** o seletor agora usa a **data do período** como valor (estável,
nunca muda de significado) em vez da posição no array, e as opções são
sempre recriadas a cada atualização, preservando a seleção atual do usuário
quando ela ainda existe na lista.

---

## O que já existia e eu só estendi (não são bugs novos)

- Foto do produto + SKU como link clicável pro anúncio: já existiam na aba
  Produtos; só repliquei o mesmo mecanismo pra dentro da aba Hoje, com filtro
  de data próprio.
- A correção de divergência financeira (pedidos com pagamento atrasado e
  cancelamentos/devoluções não refletidos) foi feita numa etapa anterior
  desta mesma revisão — ver funções `sincronizarPedidosRecentes_`,
  `corrigirDivergenciaHistorica` e a aba `RAW_Cancelados`, em `Codigo.gs`.

---

## Checklist do que você precisa fazer, na ordem

1. Substituir `Codigo.gs`, `WebApp.gs`, `app.js`, `index.html`, `style.css`
   no projeto (Apps Script + repositório do site).
2. No editor do Apps Script, rodar **uma vez**, manualmente: `criarGatilhosDiarios()`
   — isso recria os 3 gatilhos (vendas, catálogo completo, estoque rápido)
   com a nova função de estoque incluída.
3. Se ainda não rodou da vez anterior: `adicionarColunaStatusRAWVendas()` e
   `corrigirDivergenciaHistorica()` (ver revisão anterior sobre divergência
   financeira).
4. Testar o painel: aba Estoque (valores de "Valor de venda potencial" devem
   parecer razoáveis agora), aba Financeiro (escolher um mês antigo, tipo
   "Junho", e conferir o diário dele), e o Comparativo de meses (comparar
   dois meses e confirmar que os números batem com o que a aba Financeiro
   Mensal mostra pra cada um deles).

## Escopo desta revisão

Fiz uma auditoria dirigida nos pontos que você reportou (estoque, valor
potencial, financeiro por mês, comparativo) e no código diretamente
conectado a eles (sincronização de catálogo, geração das abas calculadas,
payload da API). As demais telas (Produtos, Curva ABC, Ranking de ruptura,
Ações de hoje, Meta do mês) foram revisadas por leitura/sanidade, mas não
teve motivo de queixa reportado nem indício de bug — se notar algo estranho
em qualquer uma delas, me diga o que está aparecendo e eu investigo
pontualmente, do mesmo jeito que fiz com os itens acima.
