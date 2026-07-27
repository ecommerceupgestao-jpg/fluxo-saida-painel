/**
 * WebApp.gs
 * -----------------------------------------------------------------------
 * Endpoint JSON para o site (GitHub Pages) consumir os dados já calculados
 * pela planilha (Fluxo por SKU, Saída Diária, Saída Mensal), sem expor
 * NENHUMA credencial do Mercado Livre no site público — o site só conversa
 * com este Apps Script, e este Apps Script é quem já fala com o ML.
 *
 * INSTALAÇÃO:
 * 1. No mesmo projeto Apps Script onde você colou o ML_Sync.gs, crie um
 *    novo arquivo (ícone + ao lado de "Arquivos") chamado WebApp.gs e cole
 *    este código.
 * 2. Configurações do projeto > Propriedades do script > adicione:
 *      WEBAPP_TOKEN = uma senha longa qualquer, só sua (ex: gere em
 *      https://www.uuidgenerator.net/ e copie um UUID)
 *    Isso evita que qualquer pessoa que descubra a URL do endpoint veja
 *    seus dados — não é uma segurança forte, mas impede acesso casual.
 * 3. Implantar > Nova implantação > tipo "Aplicativo da web".
 *      Executar como: Eu
 *      Quem tem acesso: Qualquer pessoa
 *    (precisa ser "Qualquer pessoa" para o site em GitHub Pages conseguir
 *    chamar o endpoint sem login Google — é por isso que o WEBAPP_TOKEN
 *    do passo 2 é importante)
 * 4. Copie a "URL do app da web" gerada — é essa URL que vai no arquivo
 *    config.js do site (veja README.md do site).
 * 5. Toda vez que você editar este código, precisa fazer "Gerenciar
 *    implantações" > editar > Nova versão, ou a URL antiga continua
 *    servindo a versão antiga.
 * -----------------------------------------------------------------------
 */

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('WEBAPP_TOKEN');
  if (!token || !e.parameter.token || e.parameter.token !== token) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'token inválido' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const payload = {
    gerado_em: new Date().toISOString(),
    produtos: sheetToObjects_(ss.getSheetByName('Fluxo por SKU'), 2), // pula coluna A (nota)
    saida_diaria: sheetComDatasToObjects_(ss.getSheetByName('Saída Diária')),
    saida_mensal: sheetComDatasToObjects_(ss.getSheetByName('Saída Mensal')),
    resumo: null
  };
  payload.resumo = resumoDiretriz_(payload.produtos);

  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// Converte uma aba "normal" (1 linha de cabeçalho + linhas de dados a
// partir da coluna startCol) numa lista de objetos {cabecalho: valor}.
function sheetToObjects_(sheet, startCol) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  const headers = sheet.getRange(1, startCol, 1, lastCol - startCol + 1).getValues()[0];
  const values = sheet.getRange(2, startCol, lastRow - 1, lastCol - startCol + 1).getValues();
  return values
    .filter(row => row[1] !== '' && row[1] !== null) // precisa ter SKU
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        if (!h) return;
        let v = row[i];
        if (v instanceof Date) v = v.toISOString();
        obj[h] = v;
      });
      return obj;
    });
}

// Para "Saída Diária" / "Saída Mensal": as 4 primeiras colunas são fixas
// (SKU, Fornecedor, Classificação, DIRETRIZ) e depois vêm N colunas de
// data — isso é transformado num array "serie" por SKU.
function sheetComDatasToObjects_(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const dataRows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  return dataRows
    .filter(row => row[0] !== '' && row[0] !== null)
    .map(row => {
      const serie = [];
      for (let c = 4; c < lastCol; c++) {
        let periodo = headerRow[c];
        if (periodo instanceof Date) periodo = periodo.toISOString().slice(0, 10);
        serie.push({ periodo: periodo, quantidade: row[c] || 0 });
      }
      return {
        sku: row[0],
        fornecedor: row[1],
        classificacao: row[2],
        diretriz: row[3],
        serie: serie
      };
    });
}

// Conta quantos produtos caem em cada DIRETRIZ, para os cards de resumo.
function resumoDiretriz_(produtos) {
  const contagem = {};
  produtos.forEach(p => {
    const d = p['DIRETRIZ'] || 'Sem DIRETRIZ';
    contagem[d] = (contagem[d] || 0) + 1;
  });
  return contagem;
}
