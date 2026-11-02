# Decoteca

Catálogo pessoal de decorações de datas festivas. Funciona direto no navegador, sem instalação, sem login e sem servidor: as fotos e os dados ficam salvos no próprio navegador de cada aparelho (IndexedDB).

## Arquivos

| Arquivo | O que tem |
|---|---|
| `index.html` | Estrutura da página e menu |
| `styles.css` | Visual. No topo ficam as variáveis de **fonte, tamanho do título e cores** |
| `app.js` | Lógica do app. No topo ficam o **nome do app** e as **listas iniciais** de categorias e tipos |

## Como abrir no computador

Opção simples: dê dois cliques em `index.html`. Isso funciona no Chrome e no Edge.

Opção recomendada (funciona em qualquer navegador): na pasta do projeto, rode

```bash
python -m http.server 8000
```

e abra http://localhost:8000.

## Como usar no celular (via GitHub Pages)

1. Suba os arquivos para um repositório no GitHub.
2. No repositório, vá em **Settings → Pages**, escolha a branch `main` e a pasta `/ (root)` e salve.
3. Depois de 1 ou 2 minutos, o GitHub mostra o link (algo como `https://seu-usuario.github.io/nome-do-repo/`).
4. Abra esse link no navegador do celular. Se quiser um atalho, use **Adicionar à tela inicial** no menu do navegador.

O link só entrega o app. **Os dados de cada aparelho continuam separados** e não vão para o GitHub.

## Levar os dados de um aparelho para outro

1. No aparelho de origem: menu **⋮ → Exportar dados**. Isso baixa um arquivo `acervo-festivo-AAAA-MM-DD.json`, com as fotos embutidas.
2. Passe o arquivo para o outro aparelho (por e-mail, WhatsApp, Google Drive etc.).
3. No aparelho de destino: menu **⋮ → Importar dados** e escolha o arquivo.
   - **Substituir tudo:** apaga o que existe no aparelho e fica só com o conteúdo do arquivo.
   - **Mesclar:** soma os itens. Se o mesmo item existir nos dois, fica a versão editada por último.

Exporte de vez em quando como backup. Limpar os dados do navegador apaga o catálogo.

## Personalizar

- **Nome do app:** constante `APP_NAME` no topo de `app.js` (e o `<title>` em `index.html`).
- **Fonte e tamanho do título:** `--title-font` e `--title-size` em `styles.css`.
- **Cores:** variáveis no topo de `styles.css`.
- **Categorias e tipos:** dentro do app, em **⋮ → Gerenciar categorias e tipos**, ou com o botão **+ Nova** na tela do item.

## Itens de exemplo

Pelo menu **⋮ → Carregar exemplos** você adiciona 12 itens para ver o app funcionando. Para apagá-los, use **⋮ → Remover exemplos**. Seus itens não são afetados.
