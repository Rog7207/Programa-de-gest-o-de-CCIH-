/* Monta o pacote de instalação/atualização do HNSC em hnsc/Aplicativo CCIH HNSC/ —
   o mesmo desenho do subprojeto Unimed: uma pasta pronta para zipar e levar ao hospital.

   O pacote leva SÓ o aplicativo (index.html, js/, css/, lib/, manual, licença) + um
   LEIA-ME. A pasta de dados NÃO vai por padrão — o banco do hospital vive lá; com
   --com-dados, copia também a pasta local "Dados CCIH HNSC" (para instalar do zero ou
   levar o banco atualizado — NUNCA sai do ambiente do hospital/da CCIH).

   Uso: node scripts/montar-pacote-hnsc.js [--com-dados]
   Rodar de novo substitui o pacote (atualização = rodar + zipar). */

const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'hnsc', 'Aplicativo CCIH HNSC');
const APP = path.join(DESTINO, 'Aplicativo CCIH');
const COM_DADOS = process.argv.includes('--com-dados');
const PASTA_DADOS = process.env.PASTA_CCIH || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');

/* O que compõe o aplicativo que roda no hospital. scripts/ (Node) e miniapps/ (montados
   por instalação, com segredos locais) ficam de fora de propósito. */
const ITENS = ['index.html', 'js', 'css', 'lib', 'MANUAL-DO-USUARIO.html', 'MANUAL-DO-USUARIO.md', 'LICENSE'];

const copiar = (de, para) => {
  const st = fs.statSync(de);
  if (st.isDirectory()) {
    fs.mkdirSync(para, { recursive: true });
    for (const nome of fs.readdirSync(de)) copiar(path.join(de, nome), path.join(para, nome));
  } else {
    fs.mkdirSync(path.dirname(para), { recursive: true });
    fs.copyFileSync(de, para);
  }
};

fs.rmSync(APP, { recursive: true, force: true });
for (const item of ITENS) {
  const origem = path.join(RAIZ, item);
  if (!fs.existsSync(origem)) { console.log('aviso: ' + item + ' não existe — pulado'); continue; }
  copiar(origem, path.join(APP, item));
  console.log('  ✓ ' + item);
}

if (COM_DADOS) {
  const destinoDados = path.join(DESTINO, 'Dados CCIH HNSC');
  if (!fs.existsSync(PASTA_DADOS)) {
    console.log('aviso: pasta de dados não encontrada em ' + PASTA_DADOS + ' — pacote sai sem dados');
  } else {
    fs.rmSync(destinoDados, { recursive: true, force: true });
    copiar(PASTA_DADOS, destinoDados);
    console.log('  ✓ Dados CCIH HNSC (cópia do banco — NÃO sai do ambiente da CCIH)');
  }
}

fs.writeFileSync(path.join(DESTINO, 'LEIA-ME.txt'),
`APLICATIVO CCIH — pacote para o HNSC
=====================================

Este pacote tem a pasta:

  Aplicativo CCIH/   → o programa (roda 100% local, sem instalar nada)
${COM_DADOS ? '  Dados CCIH HNSC/   → o banco de dados (arquivos Excel)\n' : ''}
COMO ABRIR
----------
1. Copie a pasta "Aplicativo CCIH" para o computador da CCIH.
2. Abra o arquivo  Aplicativo CCIH/index.html  no Google Chrome ou no Microsoft Edge.
   (Firefox e Safari não têm a tecnologia de pasta de dados que o programa usa.)
3. Na primeira vez, o programa pede a PASTA DE DADOS — aponte para a pasta
   "Dados CCIH HNSC" do computador (${COM_DADOS ? 'a deste pacote, copiada para o computador' : 'a que já existe lá'}).

COMO ATUALIZAR UMA INSTALAÇÃO EXISTENTE
---------------------------------------
Substitua, dentro da instalação, as pastas js/, css/, lib/ e o arquivo index.html
pelos deste pacote. A pasta de dados NÃO é tocada — o banco fica onde está, e as
colunas/abas novas são criadas sozinhas na primeira abertura.

Gerado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')} pelo scripts/montar-pacote-hnsc.js.
`);
console.log('\npacote pronto em: hnsc/Aplicativo CCIH HNSC' + (COM_DADOS ? ' (com dados)' : ' (sem dados — use --com-dados para incluir o banco)'));
console.log('para levar: compacte a pasta e copie para o pendrive/e-mail institucional.');
