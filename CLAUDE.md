# Aplicativo CCIH — contexto para sessões do Claude Code

Aplicativo 100% local (HTML/JS puro, sem build e sem servidor) para vigilância de IRAS
de uma CCIH hospitalar. Roda abrindo `index.html` no Chrome/Edge; o banco de dados são
arquivos Excel numa **pasta de dados separada**, acessada via File System Access API.
Autor: Rogério Sobroza de Mello (médico infectologista). Licença GPL-3.0.

## Regras invioláveis

- **Nunca** commitar dados de pacientes, nomes de hospitais em dados de exemplo novos,
  segredos ou e-mails pessoais. A pasta de dados real não existe no repositório — e é
  assim que deve ficar. Amostras de teste em `amostras/` são sintéticas.
- Arquivos que saem do aplicativo carregam só prontuário/iniciais, nunca nome completo
  (exceção: a página remota cifrada com senha).
- Núcleo de cálculo é **puro e testável em Node** (importacao.js, relatorios.js,
  alertas.js, protocolo-atb.js); UI fica nos `ui-*.js`. Toda mudança de cálculo ganha
  teste em `scripts/testes.js` (rodar com `node scripts/testes.js`; tudo deve passar).
- Gravações no banco passam por `comTrava([...])` + `lerBanco`/`gravarBanco` (travas por
  arquivo; `gravarBanco` preserva colunas e abas extras). Esquemas em `js/esquemas.js`
  migram sozinhos — colunas/abas novas são acrescentadas na primeira abertura.
- Regras clínicas (ex.: protocolo de antibióticos em `js/protocolo-atb.js`) são fiéis a
  documentos validados pela CCIH — não alterar conduta sem o documento mudar antes.
- Comentários e commits em português, no estilo dos existentes. Commit + push ao fim de
  cada rodada de mudanças.

## Mapa rápido

- `index.html` registra a lista de scripts (arquivo novo em js/ precisa entrar lá).
- Abas em `js/app.js` (`ABAS` + `renderizarAba`); cada aba tem seu `montar*` num `ui-*.js`.
- `js/importacao.js`: importadores, normalização, triagem de culturas, cursos de
  antibiótico, vigilância pós-alta (funções puras).
- `js/relatorios.js`: relatórios padrão + perfil microbiológico (estrutura de seções que
  vira tela e impressão).
- `js/excel.js`: camada de dados (pasta, travas, leitura/gravação, cache por assinatura).
- `miniapps/fonte/`: miniapps de celular; montados por `scripts/montar-miniapps.js` com
  segredos vindos de `config-local.json` (gitignorado — usar placeholders no código).
  `decisao-atb.html` recebe do montador o próprio `js/protocolo-atb.js` (placeholder
  `<!--PROTOCOLO-ATB-->`) e o antibiograma agregado de `antibiograma-consolidado.json`
  (gitignorado; gerado por `scripts/consolidar-antibiograma.js`).
- Manual do usuário em `MANUAL-DO-USUARIO.md` (+ .html gerado).

## Limitação das sessões na nuvem

A pasta de dados real não está disponível: não é possível validar contra o banco. Nesses
casos, escrever os testes em Node com fixtures sintéticas e avisar no resumo que a
conferência com dados reais fica para a sessão local.
