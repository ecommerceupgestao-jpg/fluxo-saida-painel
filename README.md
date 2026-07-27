# Fluxo de Saída — Painel do Analista

Site estático (HTML/CSS/JS puro, sem build) para publicar no GitHub Pages.
Mostra a mesma classificação (Estrela/Potencial/Análise) e DIRETRIZ
(🔵 FOCO / 🟢 MANUTENÇÃO / 🟡 DESPRIORIZADO / 🔴 SAÍDA / ⚫ IGNORAR) da planilha
"Fluxo de saída por SKU", já sincronizada com o Mercado Livre.

## Como funciona (arquitetura)

```
Mercado Livre API  →  Google Sheets (RAW_Vendas, fórmulas)  →  Apps Script
                                                                 (WebApp.gs)
                                                                     │
                                                              JSON via HTTPS
                                                                     │
                                                                     ▼
                                                    Este site (GitHub Pages)
```

**Importante:** este site é público — qualquer coisa em `.js` aqui pode ser
lida por qualquer visitante. Por isso ele **nunca** guarda Client ID/Secret
ou Refresh Token do Mercado Livre. Quem fala com o Mercado Livre é sempre o
Apps Script (`WebApp.gs`), que já está rodando na sua planilha. Este site
só busca um JSON já pronto nesse endpoint, usando uma URL + token que o
próprio analista cola na interface (fica salvo no `localStorage` do
navegador dele, não no repositório).

## Passo 1 — publicar o endpoint (uma vez, na planilha)

1. Extensões > Apps Script na planilha "Fluxo de saída por SKU".
2. Adicione o arquivo `WebApp.gs` (fornecido junto com este site) ao mesmo
   projeto onde já está o `ML_Sync.gs`.
3. Configurações do projeto > Propriedades do script > adicione
   `WEBAPP_TOKEN` com uma senha longa só sua.
4. Implantar > Nova implantação > tipo **Aplicativo da web** > Executar
   como **Eu** > Quem tem acesso **Qualquer pessoa**.
5. Copie a URL gerada (termina em `/exec`).

## Passo 2 — publicar o site no GitHub Pages

1. Crie um repositório novo (pode ser público) e suba os arquivos desta
   pasta (`index.html`, `style.css`, `app.js`, `config.js`) na raiz.
2. Settings > Pages > Source: `main` / pasta raiz. Salve.
3. Em alguns minutos o GitHub mostra a URL do site (algo como
   `https://seuusuario.github.io/seurepositorio/`).

## Passo 3 — conectar o painel ao endpoint

1. Abra o site publicado.
2. Clique no ícone ⚙ no topo.
3. Cole a URL do Apps Script (passo 1.5) e o `WEBAPP_TOKEN` (passo 1.3).
4. Salvar e conectar. Os dados ficam guardados no navegador — não precisa
   repetir isso a cada visita, só se mudar de navegador/computador.

## Limitações a ter em mente

- **O token não é uma segurança forte.** Ele impede acesso casual à URL do
  endpoint, mas qualquer pessoa que tenha a URL completa (com `?token=...`)
  consegue ver os dados. Não é indicado para dados extremamente sensíveis
  sem uma camada de autenticação real (ex: login).
- **Atualização não é em tempo real.** Os números vêm de `RAW_Vendas`, que
  é atualizado pelo `ML_Sync.gs` no horário do gatilho diário (às 3h, por
  padrão). O botão "Atualizar" no site busca o estado mais recente da
  planilha, não força uma nova sincronização com o Mercado Livre.
- **CORS:** Apps Script normalmente responde sem bloquear chamadas de
  outros domínios para `doGet` público. Se o navegador reclamar de CORS ao
  testar, o problema mais comum é a implantação ainda não estar em "Nova
  versão" depois de editar o `WebApp.gs` — refaça o passo "Gerenciar
  implantações > Editar > Nova versão".
