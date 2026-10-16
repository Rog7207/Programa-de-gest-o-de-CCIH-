/* Gera dossiês de internação (Markdown) para avaliação por IA local — pedido de 16/10/2026.

   Lê a pasta de dados, escolhe internados com ≥48 h e evolução disponível, monta o dossiê de
   cada um (js/dossie.js) e grava em <pasta>/dossies/<AAAA-MM-DD_HHMM>/: um .md por atendimento,
   _indice.md (lista com escore e sinais) e PROMPT-avaliacao.md (instrução para o modelo).
   Os arquivos ficam DENTRO da pasta de dados: são pseudonimizados (sem nome, sem autor) mas o
   texto livre pode conter nomes de terceiros — uso só com modelo que roda na máquina da CCIH.

   Uso:
     PASTA_CCIH="/caminho/Dados CCIH" node scripts/gerar-dossies.js            # amostra de 10
     ... --n=25                     quantidade (amostra estratificada por escore)
     ... --todos                    todos os internados elegíveis (rotina diária)
     ... --atendimentos=123,456     só estes atendimentos
     ... --evolucoes=/x/evo.xls     export cru de evoluções do Tasy a somar (pode repetir)
     ... --hoje=2026-10-16          data de referência (padrão: hoje)
     ... --saida=/pasta             destino (padrão: <pasta>/dossies/<carimbo>)
     Para cada internação saem também ATD-*.dias.txt e ATD-*.dias.json: uma linha por evento
     no eixo do dia ("D5 - Urocultura positiva: …"), entrada para classificador pequeno.
     ... --cego                     sem as decisões da CCIH (casos de IRAS, classificação das
                                    culturas) — para calibrar a IA; o gabarito vai em _gabarito.json */

const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.join(__dirname, '..');
global.XLSX = require(path.join(raiz, 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(raiz, 'js', 'esquemas.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
const leitura = require(path.join(raiz, 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
global.linhaDeItens = leitura.linhaDeItens;
const imp = require(path.join(raiz, 'js', 'importacao.js'));
for (const k of ['normalizarProntuario', 'germeDaCultura', 'culturaDoPainel', 'cursosDeAntibiotico', 'sinaisDeInfeccaoNaEvolucao',
  'sinaisVitaisNaEvolucao', 'extrairTemplateEvolucao', 'alteracoesDaMedida', 'internadosAgora', 'textoEvolucaoNormalizado', 'prescricaoAtiva']) global[k] = imp[k];
const dossie = require(path.join(raiz, 'js', 'dossie.js'));

const arg = nome => { const a = process.argv.find(x => x.startsWith('--' + nome + '=')); return a ? a.slice(nome.length + 3) : ''; };
const flag = nome => process.argv.includes('--' + nome);
const PASTA = process.env.PASTA_CCIH || arg('pasta') || path.join(os.homedir(), 'Documentos', 'Dados CCIH HNSC');
if (!fs.existsSync(path.join(PASTA, 'pacientes.xlsx'))) { console.error('Pasta de dados não encontrada (PASTA_CCIH ou --pasta=): ' + PASTA); process.exit(2); }
const hoje = arg('hoje') || new Date().toISOString().slice(0, 10);

function lerBancoArquivo(nome) {
  const esq = esquemas.ESQUEMAS[nome];
  const arq = path.join(PASTA, esq.arquivo);
  const saida = {};
  for (const aba of Object.keys(esq.abas)) saida[aba] = [];
  if (!fs.existsSync(arq)) return saida;
  const wb = XLSX.read(fs.readFileSync(arq), { type: 'buffer' });
  for (const aba of Object.keys(esq.abas)) {
    if (wb.Sheets[aba]) saida[aba] = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '', raw: false });
  }
  return saida;
}
const t0 = Date.now();
const bancos = {};
for (const n of ['pacientes', 'culturas', 'antibioticos', 'cirurgias', 'dispositivos', 'uti', 'iras', 'isolamentos', 'sepse', 'evolucoes', 'evolucoes_historico', 'denominadores']) {
  bancos[n] = lerBancoArquivo(n);
}
console.log(`Banco lido em ${Math.round((Date.now() - t0) / 1000)} s: ${bancos.pacientes.internacoes.length} internações, ${bancos.evolucoes.evolucoes.length} evoluções na foto, ${bancos.evolucoes_historico.evolucoes.length} no histórico.`);

/* Exports crus extras de evoluções (todas as linhas, sem a retenção da foto). */
const extras = [];
for (const f of process.argv.filter(a => a.startsWith('--evolucoes=')).map(a => a.slice(12))) {
  const wb = XLSX.read(new Uint8Array(fs.readFileSync(f)), { type: 'array', raw: true, dense: true });
  let n = 0;
  for (const nome of wb.SheetNames) {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' });
    const r = dossie.lerEvolucoesCompletasTasy(m);
    if (r.reconhecido) { extras.push(...r.evolucoes); n += r.evolucoes.length; }
  }
  console.log(`${path.basename(f)}: ${n} evoluções${n ? '' : ' (não reconhecido como export de evoluções do Tasy)'}`);
}

const atendimentos = arg('atendimentos') ? arg('atendimentos').split(',').map(s => s.trim()).filter(Boolean) : null;
const candidatos = dossie.selecionarInternacoesParaDossie(bancos, { hoje, evolucoesExtras: extras, atendimentos, semExigirEvolucao: !!atendimentos });
console.log(`Elegíveis (internados ≥48 h com evolução na janela): ${candidatos.length}`);
if (!candidatos.length) { console.log('Nada a gerar.'); process.exit(0); }

const n = Number(arg('n')) || 10;
const escolhidos = (flag('todos') || atendimentos) ? candidatos : dossie.amostrarDossies(candidatos, n);

const carimbo = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const destino = arg('saida') || path.join(PASTA, 'dossies', carimbo);
fs.mkdirSync(destino, { recursive: true });
fs.writeFileSync(path.join(destino, 'PROMPT-avaliacao.md'), dossie.PROMPT_AVALIACAO_DOSSIE, 'utf-8');

const indice = [`# Dossiês gerados em ${dossie.dataBR(hoje)} — ${escolhidos.length} de ${candidatos.length} internações elegíveis`, '',
  'Pseudonimizados (sem nome, sem autor). Texto livre pode citar terceiros: uso interno, modelo local.', '',
  '| Arquivo | Dia | Setor | Evoluções | Escore | Sinais automáticos | IRAS já registrada |', '|---|---|---|---|---|---|---|'];
let totalChars = 0;
for (const c of escolhidos) {
  const texto = dossie.renderizarDossie(c.dossie, { cego: flag('cego') });
  const nome = `ATD-${c.atendimento}.md`;
  fs.writeFileSync(path.join(destino, nome), texto, 'utf-8');
  /* Formato por dia (D5 - urocultura positiva…), para classificador: texto e JSON. Sempre
     sem as decisões da CCIH. */
  fs.writeFileSync(path.join(destino, `ATD-${c.atendimento}.dias.txt`), dossie.linhasPorDia(c.dossie), 'utf-8');
  fs.writeFileSync(path.join(destino, `ATD-${c.atendimento}.dias.json`), JSON.stringify({ atendimento: c.atendimento,
    idade: c.dossie.paciente.idade, sexo: c.dossie.paciente.sexo, admissao: c.dossie.admissao, diaReferencia: c.dossie.diaReferencia,
    eventos: dossie.linhaDoTempoPorDia(c.dossie) }, null, 1), 'utf-8');
  totalChars += texto.length;
  indice.push(`| ${nome} | D${c.dia} | ${c.setor} | ${c.evolucoes} | ${c.escore} | ${c.sinais.join(', ')} | ${c.irasRegistrada ? 'sim' : ''} |`);
}
fs.writeFileSync(path.join(destino, '_indice.md'), indice.join('\n') + '\n', 'utf-8');
/* Gabarito: o que a CCIH já registrou em cada internação (para comparar com a IA). */
fs.writeFileSync(path.join(destino, '_gabarito.json'), JSON.stringify(escolhidos.map(c => ({
  atendimento: c.atendimento, dia: c.dia, setor: c.setor, escore: c.escore,
  iras: c.dossie.iras.map(i => ({ id: i.id, topografia: i.topografia, dia: i.dia, status: i.status, criterio: i.criterio, microrganismo: i.microrganismo })),
  culturasClassificadas: c.dossie.culturas.filter(x => x.classificacao).map(x => ({ dia: x.dia, material: x.material, microrganismo: x.microrganismo, classificacao: x.classificacao }))
})), null, 2), 'utf-8');

console.log(`\n${escolhidos.length} dossiês em ${destino}`);
console.log(`Tamanho médio: ${Math.round(totalChars / escolhidos.length / 1000)} mil caracteres (~${Math.round(totalChars / escolhidos.length / 3.5 / 100) * 100} tokens).`);
const distEsc = {};
for (const c of candidatos) { const k = c.escore >= 10 ? '10+' : c.escore >= 5 ? '5-9' : c.escore >= 1 ? '1-4' : '0'; distEsc[k] = (distEsc[k] || 0) + 1; }
console.log('Distribuição do escore entre os elegíveis:', JSON.stringify(distEsc));
const distEvo = {};
for (const c of candidatos) { const k = c.evolucoes >= 20 ? '20+' : c.evolucoes >= 10 ? '10-19' : c.evolucoes >= 5 ? '5-9' : String(c.evolucoes); distEvo[k] = (distEvo[k] || 0) + 1; }
console.log('Evoluções por dossiê entre os elegíveis:', JSON.stringify(distEvo));
console.log('\nEscolhidos (atendimento · dia · setor · evoluções · escore):');
for (const c of escolhidos) console.log(`  ${c.atendimento} · D${c.dia} · ${c.setor} · ${c.evolucoes} evol · escore ${c.escore}${c.irasRegistrada ? ' · IRAS registrada' : ''}`);
