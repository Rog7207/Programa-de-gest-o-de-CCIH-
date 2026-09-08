/* Testes do pipeline do importador (roda em Node): leitura de formatos,
   detecção de cabeçalho, mapeamento, normalização, validação e deduplicação. */
const fs = require('fs');
const path = require('path');

global.XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));
const esquemas = require(path.join(__dirname, '..', 'js', 'esquemas.js'));
const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.TIPOS_RELATORIO = esquemas.TIPOS_RELATORIO;
global.CLASSIFICACOES_CULTURA = esquemas.CLASSIFICACOES_CULTURA;
global.SINONIMOS_CLASSIFICACAO = esquemas.SINONIMOS_CLASSIFICACAO;
global.CLASSES_TRIAGEM = esquemas.CLASSES_TRIAGEM;
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));
global.normalizarProntuario = imp.normalizarProntuario;
global.prescricaoAtiva = imp.prescricaoAtiva;

const pastaAmostras = path.join(__dirname, '..', 'amostras');
let passaram = 0, falharam = 0;
function verificar(descricao, condicao, detalhe) {
  if (condicao) { passaram++; console.log('  ok  -', descricao); }
  else { falharam++; console.log('  FALHOU -', descricao, detalhe !== undefined ? `(obtido: ${JSON.stringify(detalhe)})` : ''); }
}
function lerAmostra(nome) {
  return leitura.lerBruto(new Uint8Array(fs.readFileSync(path.join(pastaAmostras, nome))), nome, 'auto');
}
const vocabulario = {};
Object.keys(esquemas.VOCABULARIO_INICIAL).forEach(v => {
  vocabulario[v] = esquemas.VOCABULARIO_INICIAL[v].map(item => typeof item === 'string' ? item : item.Nome);
});

console.log('\n== 1. Culturas xlsx (cabeçalho fora da linha 1, antibiograma largo) ==');
{
  const bruto = lerAmostra('culturas_lab.xlsx');
  const cab = leitura.detectarCabecalho(bruto.linhas);
  verificar('cabeçalho detectado na linha 4', cab === 3, cab);
  const cabecalhos = bruto.linhas[cab].map(String);
  const fp = leitura.calcularFingerprint(cabecalhos);
  verificar('fingerprint estável', fp === leitura.calcularFingerprint(cabecalhos) && fp.length === 8, fp);

  const mapa = imp.sugerirMapeamento(cabecalhos, bruto.linhas.slice(cab + 1), 'culturas');
  const destinoDe = nome => (mapa.find(m => m.cabecalho === nome) || {}).destino;
  verificar('Prontuário mapeado', destinoDe('Prontuário') === 'Prontuario', destinoDe('Prontuário'));
  verificar('Data Coleta mapeada', destinoDe('Data Coleta') === 'DataColeta', destinoDe('Data Coleta'));
  verificar('Data Liberação → DataResultado', destinoDe('Data Liberação') === 'DataResultado', destinoDe('Data Liberação'));
  verificar('Material mapeado', destinoDe('Material') === 'Material');
  verificar('Microorganismo mapeado', destinoDe('Microorganismo') === 'Microrganismo', destinoDe('Microorganismo'));
  verificar('Nome do Paciente mapeado', destinoDe('Nome do Paciente') === 'NomePaciente', destinoDe('Nome do Paciente'));
  const antibiograma = mapa.filter(m => m.destino === '@antibiograma').map(m => m.cabecalho);
  verificar('colunas de antibiograma detectadas (≥4)', antibiograma.length >= 4, antibiograma);

  const { registros, problemas } = imp.normalizarLinhas(bruto.linhas, cab, mapa, 'culturas', []);
  verificar('7 registros lidos', registros.length === 7, registros.length);
  const primeiro = registros[0];
  verificar('data normalizada para ISO', primeiro.DataColeta === '2026-08-05', primeiro.DataColeta);
  verificar('prontuário preserva zeros à esquerda', primeiro.Prontuario === '0012345', primeiro.Prontuario);
  verificar('"Sensível" vira S', primeiro._antibiograma.some(a => a.Antibiotico === 'AMICACINA' && a.Resultado === 'S'), primeiro._antibiograma);
  verificar('antibiograma com 4 resultados na 1ª linha', primeiro._antibiograma.length === 4, primeiro._antibiograma.length);
  verificar('data inválida gera aviso', problemas.some(p => p.motivo === 'data não reconhecida'), problemas);

  const validacao = imp.validar(registros, 'culturas', vocabulario);
  verificar('prontuário vazio gera erro bloqueante', validacao.erros.some(e => e.motivo.includes('Prontuário')), validacao.erros);
  verificar('data obrigatória inválida gera erro', validacao.erros.some(e => e.campo === 'DataColeta'), validacao.erros);
  verificar('KLEB PNEUMONIAE é termo novo', (validacao.termosNovos.microrganismos || []).includes('KLEB PNEUMONIAE'), validacao.termosNovos);
  verificar('setores novos detectados', (validacao.termosNovos.setores || []).length >= 2, validacao.termosNovos.setores);

  const linhasComErro = new Set(validacao.erros.map(e => e.linha));
  const validos = registros.filter(r => !linhasComErro.has(r._linha));
  const dedup = imp.deduplicar(validos, [], 'culturas');
  verificar('linha repetida do arquivo vira duplicado interno', dedup.duplicadosInternos.length === 1, dedup.duplicadosInternos.length);
  verificar('4 registros novos', dedup.novos.length === 4, dedup.novos.length);

  const denovo = imp.deduplicar(dedup.novos, dedup.novos, 'culturas');
  verificar('reimportação: tudo duplicado', denovo.novos.length === 0 && denovo.duplicados.length === 4, denovo.novos.length + '/' + denovo.duplicados.length);
}

console.log('\n== 2. Culturas csv (Windows-1252, separador ;) ==');
{
  const bruto = lerAmostra('culturas_lab.csv');
  verificar('codificação detectada', bruto.codificacao === 'windows-1252', bruto.codificacao);
  const cab = leitura.detectarCabecalho(bruto.linhas);
  verificar('cabeçalho na linha 1', cab === 0, cab);
  const mapa = imp.sugerirMapeamento(bruto.linhas[cab].map(String), bruto.linhas.slice(cab + 1), 'culturas');
  const { registros } = imp.normalizarLinhas(bruto.linhas, cab, mapa, 'culturas', []);
  verificar('acentos preservados', registros[0].NomePaciente === 'JOSÉ ARAÚJO', registros[0].NomePaciente);
  verificar('material com acento correto', registros[0].Material === 'Secreção traqueal', registros[0].Material);
}

console.log('\n== 3. Prescrições xls antigo (BIFF8, data em número serial) ==');
{
  const bruto = lerAmostra('prescricoes.xls');
  const cab = leitura.detectarCabecalho(bruto.linhas);
  const mapa = imp.sugerirMapeamento(bruto.linhas[cab].map(String), bruto.linhas.slice(cab + 1), 'antibioticos');
  const destinoDe = nome => (mapa.find(m => m.cabecalho === nome) || {}).destino;
  verificar('Medicamento → Antibiotico', destinoDe('Medicamento') === 'Antibiotico', destinoDe('Medicamento'));
  verificar('Posologia → Frequencia', destinoDe('Posologia') === 'Frequencia', destinoDe('Posologia'));
  verificar('Data Início mapeada', destinoDe('Data Início') === 'DataInicio', destinoDe('Data Início'));
  const { registros } = imp.normalizarLinhas(bruto.linhas, cab, mapa, 'antibioticos', []);
  verificar('3 prescrições lidas', registros.length === 3, registros.length);
  const esperado = (() => { const d = XLSX.SSF.parse_date_code(46252); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; })();
  verificar('data em serial convertida', registros[1].DataFim === esperado, registros[1].DataFim + ' ≠ ' + esperado);
  const validacao = imp.validar(registros, 'antibioticos', vocabulario);
  verificar('CEFTRIAXONA reconhecida no vocabulário (caixa alta)', !(validacao.termosNovos.antibioticos || []).includes('CEFTRIAXONA'), validacao.termosNovos);
}

console.log('\n== 4. Culturas dbf (nomes de campo truncados de sistema legado) ==');
{
  const bruto = lerAmostra('culturas.dbf');
  const cab = leitura.detectarCabecalho(bruto.linhas);
  const cabecalhos = bruto.linhas[cab].map(String);
  verificar('dbf lido com 2 registros', bruto.linhas.length === 3, bruto.linhas.length);
  const mapa = imp.sugerirMapeamento(cabecalhos, bruto.linhas.slice(cab + 1), 'culturas');
  const destinoDe = nome => (mapa.find(m => m.cabecalho === nome) || {}).destino;
  verificar('PRONTUARIO mapeado', destinoDe('PRONTUARIO') === 'Prontuario', destinoDe('PRONTUARIO'));
  verificar('DATACOLETA mapeada', destinoDe('DATACOLETA') === 'DataColeta', destinoDe('DATACOLETA'));
  verificar('GERME → Microrganismo', destinoDe('GERME') === 'Microrganismo', destinoDe('GERME'));
  const { registros } = imp.normalizarLinhas(bruto.linhas, cab, mapa, 'culturas', []);
  verificar('registros do dbf normalizados', registros.length === 2 && registros[0].DataColeta === '2026-08-09', registros[0]);
}

console.log('\n== 5. Cirurgias xlsx (NHSN, ASA, contaminação, NNIS) ==');
{
  const bruto = lerAmostra('cirurgias.xlsx');
  const cab = leitura.detectarCabecalho(bruto.linhas);
  verificar('cabeçalho na linha 1', cab === 0, cab);
  const mapa = imp.sugerirMapeamento(bruto.linhas[cab].map(String), bruto.linhas.slice(cab + 1), 'cirurgias');
  const destinoDe = nome => (mapa.find(m => m.cabecalho === nome) || {}).destino;
  verificar('Telefone mapeado', destinoDe('Telefone') === 'Telefone');
  verificar('Data Cirurgia mapeada', destinoDe('Data Cirurgia') === 'DataCirurgia', destinoDe('Data Cirurgia'));
  verificar('Procedimento mapeado', destinoDe('Procedimento') === 'Procedimento');
  verificar('Potencial de Contaminação mapeado', destinoDe('Potencial de Contaminação') === 'PotencialContaminacao', destinoDe('Potencial de Contaminação'));
  verificar('Hora Início mapeada', destinoDe('Hora Início') === 'HoraInicio', destinoDe('Hora Início'));

  const aliases = [{ Campo: 'procedimentos_nhsn', De: 'CESARIANA', Para: 'Cesariana' }];
  const { registros } = imp.normalizarLinhas(bruto.linhas, cab, mapa, 'cirurgias', aliases);
  verificar('3 cirurgias lidas', registros.length === 3, registros.length);
  verificar('alias NHSN aplicado com original preservado',
    registros[0].Procedimento === 'Cesariana' && registros[0]._originais.Procedimento === 'CESARIANA', registros[0]._originais);

  const tempoCorte = { cesariana: 1, colecistectomia: 2 };
  const linha1 = imp.enriquecerCirurgia({ ...registros[0], ProcedimentoNHSN: 'Cesariana' }, tempoCorte);
  verificar('ASA romano vira número', linha1.ASA === '2', linha1.ASA);
  verificar('duração calculada das horas', linha1.DuracaoMin === '55', linha1.DuracaoMin);
  verificar('NNIS calculado (ASA 2, pot. contaminada, 55 min ≤ 60)', linha1.IndiceNNIS === '0', linha1.IndiceNNIS);

  const linha2 = imp.enriquecerCirurgia({ ...registros[1], ProcedimentoNHSN: 'Colecistectomia' }, tempoCorte);
  verificar('duração cruzando meia-noite', linha2.DuracaoMin === '100', linha2.DuracaoMin);
  verificar('Limpa-contaminada normalizada', linha2.PotencialContaminacao === 'Potencialmente contaminada', linha2.PotencialContaminacao);
  verificar('NNIS 1 (ASA III)', linha2.IndiceNNIS === '1', linha2.IndiceNNIS);

  const linha3 = imp.enriquecerCirurgia({ ...registros[2], ProcedimentoNHSN: 'Herniorrafia' }, tempoCorte);
  verificar('sem tempo de corte → NNIS vazio', !linha3.IndiceNNIS, linha3.IndiceNNIS);

  verificar('Desfecho mapeado para Óbito', destinoDe('Desfecho') === 'Obito', destinoDe('Desfecho'));
  verificar('"ALTA MELHORADA" vira Obito=N e vigilância pendente',
    linha1.Obito === 'N' && (linha1.StatusVigilancia || 'pendente') === 'pendente', linha1.Obito + '/' + linha1.StatusVigilancia);
  verificar('"ÓBITO" vira Obito=S e vigilância não se aplica',
    linha2.Obito === 'S' && linha2.StatusVigilancia === 'não se aplica (óbito)', linha2.Obito + '/' + linha2.StatusVigilancia);
  verificar('desfecho vazio fica vazio', linha3.Obito === '', JSON.stringify(linha3.Obito));

  const validacao = imp.validar(registros, 'cirurgias', vocabulario);
  verificar('procedimentos fora do NHSN viram termos novos', (validacao.termosNovos.procedimentos_nhsn || []).length === 2, validacao.termosNovos.procedimentos_nhsn);
}

console.log('\n== 6. Casos de IRAS de outro sistema (csv) ==');
{
  const bruto = lerAmostra('iras_migracao.csv');
  const cab = leitura.detectarCabecalho(bruto.linhas);
  const mapa = imp.sugerirMapeamento(bruto.linhas[cab].map(String), bruto.linhas.slice(cab + 1), 'iras');
  const destinoDe = nome => (mapa.find(m => m.cabecalho === nome) || {}).destino;
  verificar('Data da Infecção mapeada', destinoDe('Data da Infecção') === 'DataInfeccao', destinoDe('Data da Infecção'));
  verificar('Topografia mapeada', destinoDe('Topografia') === 'Topografia');
  verificar('Dispositivo mapeado', destinoDe('Dispositivo') === 'DispositivoAssociado', destinoDe('Dispositivo'));
  const { registros } = imp.normalizarLinhas(bruto.linhas, cab, mapa, 'iras', []);
  verificar('2 casos lidos', registros.length === 2, registros.length);
  const validacao = imp.validar(registros, 'iras', vocabulario);
  verificar('"IPCS laboratorial" é termo novo de topografia', (validacao.termosNovos.topografias || []).includes('IPCS laboratorial'), validacao.termosNovos.topografias);
  verificar('dispositivo CVC normalizado', imp.normalizarDispositivo('cateter venoso central') === 'CVC');
  verificar('dispositivo VM normalizado', imp.normalizarDispositivo('ventilação mecânica') === 'VM');
  verificar('dispositivo nenhum', imp.normalizarDispositivo('não') === 'Nenhum');
  const dedup = imp.deduplicar(registros, [], 'iras');
  verificar('2 casos novos', dedup.novos.length === 2, dedup.novos.length);
}

console.log('\n== 7. Aliases e utilitários ==');
{
  const aliases = [{ Campo: 'microrganismos', De: 'KLEB PNEUMONIAE', Para: 'Klebsiella pneumoniae' }];
  const bruto = lerAmostra('culturas_lab.xlsx');
  const cab = leitura.detectarCabecalho(bruto.linhas);
  const mapa = imp.sugerirMapeamento(bruto.linhas[cab].map(String), bruto.linhas.slice(cab + 1), 'culturas');
  const { registros } = imp.normalizarLinhas(bruto.linhas, cab, mapa, 'culturas', aliases);
  verificar('alias aplicado na normalização', registros[0].Microrganismo === 'Klebsiella pneumoniae', registros[0].Microrganismo);

  verificar('normalizarData dd-mm-aaaa', imp.normalizarData('05-08-2026') === '2026-08-05', imp.normalizarData('05-08-2026'));
  verificar('normalizarData ano com 2 dígitos', imp.normalizarData('5/8/26') === '2026-08-05', imp.normalizarData('5/8/26'));
  verificar('normalizarData inválida → null', imp.normalizarData('40/40/2026') === null);
  verificar('prontuário float vira inteiro', imp.normalizarProntuario('12345.0') === '12345');
  const gerar = imp.proximoID([{ ID_Cultura: 'CUL-000041' }], 'ID_Cultura', 'CUL');
  verificar('próximo ID continua a sequência', gerar() === 'CUL-000042' && gerar() === 'CUL-000043');
}

console.log('\n== 8. Motor de alertas (surtos e multirresistentes) ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const culturas = [
    { ID_Cultura: 'CUL-1', Prontuario: '1', Setor: 'UTI', DataColeta: '2026-08-01', Material: 'Hemocultura', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: '' },
    { ID_Cultura: 'CUL-2', Prontuario: '2', Setor: 'UTI', DataColeta: '2026-08-05', Material: 'Urocultura', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'KPC' },
    { ID_Cultura: 'CUL-3', Prontuario: '3', Setor: 'UTI', DataColeta: '2026-08-10', Material: 'Secreção traqueal', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: '' },
    { ID_Cultura: 'CUL-4', Prontuario: '1', Setor: 'UTI', DataColeta: '2026-08-11', Material: 'Hemocultura', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: '' },
    { ID_Cultura: 'CUL-5', Prontuario: '4', Setor: 'Clínica', DataColeta: '2026-08-02', Material: 'Hemocultura', Microrganismo: 'Staphylococcus aureus', MecanismoResistencia: '' },
    { ID_Cultura: 'CUL-6', Prontuario: '5', Setor: 'UTI', DataColeta: '2026-06-01', Material: 'Hemocultura', Microrganismo: 'Escherichia coli', MecanismoResistencia: 'ESBL' }
  ];
  const sensibilidade = [
    { ID_Cultura: 'CUL-5', Antibiotico: 'Oxacilina', Resultado: 'R' },
    { ID_Cultura: 'CUL-3', Antibiotico: 'Meropenem', Resultado: 'R' },
    { ID_Cultura: 'CUL-1', Antibiotico: 'Meropenem', Resultado: 'S' }
  ];
  const surtos = alertas.detectarSurtos(culturas);
  verificar('surto de Klebsiella na UTI detectado (3 pacientes distintos)',
    surtos.length === 1 && surtos[0].Pacientes === 3 && surtos[0].Setor === 'UTI', surtos);
  const mdr = alertas.detectarMultirresistentes(culturas, sensibilidade, '2026-08-14');
  const mecanismos = mdr.map(m => m.ID_Cultura + ':' + m.Mecanismo + ':' + m.Origem).sort();
  verificar('KPC declarado no laudo detectado', mecanismos.some(m => m === 'CUL-2:KPC:laudo'), mecanismos);
  verificar('MRSA inferido do antibiograma', mecanismos.some(m => m === 'CUL-5:MRSA:antibiograma'), mecanismos);
  verificar('carbapenêmico-resistente inferido', mecanismos.some(m => m.startsWith('CUL-3:Resistente a carbapen')), mecanismos);
  verificar('fora da janela de 30 dias não alerta', !mdr.some(m => m.ID_Cultura === 'CUL-6'), mdr.map(m => m.ID_Cultura));
  verificar('sensível a meropenem não alerta', !mdr.some(m => m.ID_Cultura === 'CUL-1'), mdr.map(m => m.ID_Cultura));
}

console.log('\n== 9. Antibiograma em campo único e descartes ==');
{
  const itens = imp.extrairAntibiogramaTexto('Amicacina: S; Gentamicina - Resistente; Meropenem R');
  verificar('3 itens extraídos do texto', itens.length === 3, itens);
  verificar('resultados S/R/R corretos', itens.map(i => i.Resultado).join('') === 'SRR', itens);
  verificar('nomes limpos', itens[1].Antibiotico === 'Gentamicina', itens[1]);
  const virgula = imp.extrairAntibiogramaTexto('AMI=S, GEN=R');
  verificar('separador vírgula com sinal =', virgula.length === 2 && virgula[1].Antibiotico === 'GEN', virgula);
  verificar('texto sem antibiograma → vazio', imp.extrairAntibiogramaTexto('cultura positiva').length === 0);

  /* Formato do laudo do HNSC: um rótulo governa a lista inteira que vem depois. */
  const lista = imp.extrairAntibiogramaTexto('Resistente: Amicacina, Cefepima, Piperacilina + Tazobactam');
  verificar('rótulo aplicado à lista toda', lista.length === 3 && lista.every(i => i.Resultado === 'R'), lista);
  verificar('nome com + preservado', lista[2].Antibiotico === 'Piperacilina + Tazobactam', lista[2]);
  const misto = imp.extrairAntibiogramaTexto('Resistente: Oxacilina, Eritromicina | Sensível: Vancomicina');
  verificar('dois rótulos no mesmo campo', misto.map(i => i.Resultado).join('') === 'RRS', misto);
  const comObs = imp.extrairAntibiogramaTexto('Resistente: Meropenem | Bacilo Gram negativo resistente aos carbapenêmicos na amostra analisada');
  verificar('observação em texto livre é ignorada', comObs.length === 1 && comObs[0].Antibiotico === 'Meropenem', comObs);
  verificar('antibiótico repetido não duplica',
    imp.extrairAntibiogramaTexto('Resistente: Amicacina, Amicacina').length === 1);
  verificar('remonta o texto a partir dos itens',
    imp.textoAntibiograma([{ Antibiotico: 'Amicacina', Resultado: 'S' }, { Antibiotico: 'Cefepima', Resultado: 'R' }])
      === 'Sensível: Amicacina | Resistente: Cefepima');

  verificar('classificação do relatório vira a canônica', imp.classificacaoCanonica('Admissão') === 'Presente na admissão');
  verificar('bacterioscopia não é cultura', imp.classificacaoCanonica('Bacterioscopia') === 'Não é cultura');
  verificar('classificação desconhecida → vazio', imp.classificacaoCanonica('Qualquer coisa') === '');

  const linhas = [['Prontuário', 'Data Coleta', 'Material', 'Microorganismo', 'Antibiograma'],
    ['123', '10/08/2026', 'Urocultura', 'Escherichia coli', 'Amicacina: S; Ciprofloxacino: R']];
  const mapa = imp.sugerirMapeamento(linhas[0], [linhas[1]], 'culturas');
  mapa.find(m => m.cabecalho === 'Antibiograma').destino = '@antibiograma_texto';
  const { registros } = imp.normalizarLinhas(linhas, 0, mapa, 'culturas', []);
  verificar('antibiograma remontado do campo único', registros[0]._antibiograma.length === 2
    && registros[0]._antibiograma[1].Resultado === 'R', registros[0]._antibiograma);

  const alertas2 = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const descartada = [{ ID_Cultura: 'X', Prontuario: '9', Setor: 'UTI', DataColeta: '2026-08-13', Material: 'Hemocultura', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'KPC', StatusRevisao: 'descartada' }];
  verificar('cultura descartada não gera alerta MDR', alertas2.detectarMultirresistentes(descartada, [], '2026-08-14').length === 0);
  verificar('swab vaginal no vocabulário', vocabulario.materiais.includes('Swab vaginal (pesquisa de SGB)'));
  verificar('"Outros" no vocabulário de materiais', vocabulario.materiais.includes('Outros'));
}

console.log('\n== 10. Sugestão de equivalência no de-para ==');
{
  const materiais = vocabulario.materiais;
  verificar('Fragmento de tecido no vocabulário', materiais.includes('Fragmento de tecido'));
  verificar('spp por gênero no vocabulário', vocabulario.microrganismos.includes('Staphylococcus spp')
    && vocabulario.microrganismos.includes('Klebsiella spp'));
  verificar('sangue → Hemocultura', imp.sugerirEquivalente('SANGUE', materiais, 'materiais') === 'Hemocultura',
    imp.sugerirEquivalente('SANGUE', materiais, 'materiais'));
  verificar('urina → Urocultura', imp.sugerirEquivalente('Urina jato médio', materiais, 'materiais') === 'Urocultura',
    imp.sugerirEquivalente('Urina jato médio', materiais, 'materiais'));
  verificar('biópsia → Fragmento de tecido', imp.sugerirEquivalente('BIÓPSIA ÓSSEA', materiais, 'materiais') === 'Fragmento de tecido');
  verificar('KLEB PNEUMONIAE → Klebsiella pneumoniae',
    imp.sugerirEquivalente('KLEB PNEUMONIAE', vocabulario.microrganismos, 'microrganismos') === 'Klebsiella pneumoniae',
    imp.sugerirEquivalente('KLEB PNEUMONIAE', vocabulario.microrganismos, 'microrganismos'));
  verificar('CESARIANA → Cesariana (NHSN)',
    imp.sugerirEquivalente('CESARIANA', vocabulario.procedimentos_nhsn, 'procedimentos_nhsn') === 'Cesariana');
  verificar('termo sem parecido → sem sugestão',
    imp.sugerirEquivalente('XYZWK', vocabulario.microrganismos, 'microrganismos') === null);
}

console.log('\n== 11. Avaliação remota de antimicrobianos ==');
{
  global.inferirMecanismo = require(path.join(__dirname, '..', 'js', 'alertas.js')).inferirMecanismo;
  const av = require(path.join(__dirname, '..', 'js', 'avaliacao.js'));
  const bancos = {
    prescricoes: [
      { ID_Prescricao: 'PRE-000001', Prontuario: '0012345', Antibiotico: 'Meropenem', DataInicio: '2026-08-10', DataFim: '', Setor: 'UTI', Indicacao: 'PAV', UltimaEvolucao: 'Paciente febril.' },
      { ID_Prescricao: 'PRE-000002', Prontuario: '0012345', Antibiotico: 'Vancomicina', DataInicio: '2026-08-01', DataFim: '2026-08-08' },
      { ID_Prescricao: 'PRE-000003', Prontuario: '777', Antibiotico: 'Ceftriaxona', DataInicio: '2026-08-14', DataFim: '' },
      { ID_Prescricao: 'PRE-000004', Prontuario: '888', Antibiotico: 'Cefepima', DataInicio: '2026-08-12', DataFim: '' }
    ],
    avaliacoes: [{ ID_Prescricao: 'PRE-000004', Avaliador: 'X', CriadoEm: 'y' }],
    culturas: [{ ID_Cultura: 'CUL-1', Prontuario: '0012345', DataColeta: '2026-08-12', Material: 'Secreção traqueal', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: '', StatusRevisao: 'pendente' }],
    sensibilidade: [{ ID_Cultura: 'CUL-1', Antibiotico: 'Meropenem', Resultado: 'R' }],
    pacientes: [{ Prontuario: '0012345', Nome: 'MARIA' }]
  };
  const dados = av.montarDadosAvaliacao(bancos, '2026-08-19');
  verificar('avaliada e encerrada fora; 2 pacientes pendentes', dados.pacientes.length === 2, dados.pacientes.map(p => p.prontuario));
  const maria = dados.pacientes[0];
  verificar('paciente com incompatibilidade priorizado', maria.prontuario === '0012345', dados.pacientes.map(p => p.prontuario));
  verificar('alerta cultura × prescrição', maria.alertas.some(a => a.includes('resistente a Meropenem')), maria.alertas);
  verificar('multirresistente inferido no alerta', maria.alertas.some(a => a.includes('carbapen')), maria.alertas);
  verificar('antimicrobiano prévio listado', maria.previos.length === 1 && maria.previos[0].atb === 'Vancomicina', maria.previos);
  verificar('evolução acompanha a prescrição', maria.prescricoes[0].evolucao === 'Paciente febril.', maria.prescricoes[0].evolucao);
  verificar('dias de uso calculados', maria.prescricoes[0].dias === 9, maria.prescricoes[0].dias);
  verificar('descartada não entra: só culturas válidas', maria.culturas.length === 1);
}

console.log('\n== 12. Pendências de isolamento ==');
{
  const alertas3 = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const culturas = [
    { ID_Cultura: 'C1', Prontuario: '1', Setor: 'UTI', DataColeta: '2026-08-15', Material: 'Hemocultura', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'KPC' },
    { ID_Cultura: 'C2', Prontuario: '2', Setor: 'CM', DataColeta: '2026-08-16', Material: 'Urocultura', Microrganismo: 'Escherichia coli', MecanismoResistencia: 'ESBL' },
    { ID_Cultura: 'C3', Prontuario: '3', Setor: 'CM', DataColeta: '2026-08-17', Material: 'Escarro', Microrganismo: 'Mycobacterium tuberculosis', MecanismoResistencia: 'MDR-TB' },
    { ID_Cultura: 'C4', Prontuario: '4', Setor: 'CM', DataColeta: '2026-08-14', Material: 'Hemocultura', Microrganismo: 'Staphylococcus aureus', MecanismoResistencia: 'MRSA' }
  ];
  const precaucoes = [{ Prontuario: '1', TipoPrecaucao: 'Contato', DataInicio: '2026-08-14', DataFim: '' }];
  const decisoes = [{ ID_Cultura: 'C4', Decisao: 'não indicado' }];
  const pend = alertas3.pendenciasIsolamento(culturas, [], precaucoes, decisoes, '2026-08-20');
  verificar('já isolado não vira pendência', !pend.some(p => p.Prontuario === '1'), pend.map(p => p.Prontuario));
  verificar('decisão registrada não vira pendência', !pend.some(p => p.ID_Cultura === 'C4'), pend.map(p => p.ID_Cultura));
  verificar('2 pendências restantes', pend.length === 2, pend.length);
  verificar('sugestão contato para ESBL', pend.find(p => p.ID_Cultura === 'C2').Sugestao === 'Contato');
  verificar('sugestão aerossol para tuberculose', pend.find(p => p.ID_Cultura === 'C3').Sugestao === 'Aerossol');
  const precaucaoEncerrada = [{ Prontuario: '2', TipoPrecaucao: 'Contato', DataInicio: '2026-08-01', DataFim: '2026-08-10' }];
  const pend2 = alertas3.pendenciasIsolamento(culturas.slice(1, 2), [], precaucaoEncerrada, [], '2026-08-20');
  verificar('precaução encerrada volta a gerar pendência', pend2.length === 1, pend2.length);
}

console.log('\n== 13. Leitor do PDF do laboratório ==');
{
  const fixture = [
    'O.S.: 046-1  Data: 01/08/2026 12:17:35   Paciente: Getulio da Silva',
    'Sexo: Masculino  Idade: 75 anos   Data nasc.: 07/11/1950   Unidade coleta: H UNID 05 (HNSC)',
    'Telefone:999185191   Endereco do paciente: x',
    'Procedimento: CULT - UROCULTURA',
    'Material:      Urina amostra isolada       Data coleta: 01/08/2026 13:15:19',
    'Grupo: BGN (cultura em geral)     Resultado:   ~Klebsiella pneumoniae~',
    'Antimicrobiano       Classificação    Mic',
    'Piperacilina ? Tazobactam       Sensível',
    'Ceftriaxona       Resistente',
    'Procedimento: SWR - VIGILANCIA',
    'Material:      Swab retal       Data coleta: 01/08/2026 14:00:00',
    'Grupo: BGN     Resultado: Bacilo Gram negativo resistente aos carbapenêmicos na',
    'amostra analisada',
    'O.S.: 047-2  Data: 01/08/2026   Paciente: Ana Lima',
    'Sexo: Feminino  Idade: 30 anos  Data nasc.: 01/01/1996   Unidade coleta: H UTI NEO (HNSC)',
    'Procedimento: SWN - VIGILANCIA NASAL',
    'Material:      Swab nasal       Data coleta: 02/08/2026 08:00:00',
    'Grupo: CGP     Resultado: Houve crescimento de MRSA na amostra analisada'
  ];
  const aoa = imp.analisarPDFCulturas(fixture);
  verificar('3 culturas extraídas do PDF', aoa.length === 4, aoa.length);
  const [cab, c1, c2, c3] = aoa;
  const idx = nome => cab.indexOf(nome);
  verificar('pseudo-prontuário estável', c1[idx('Prontuario')] === '07111950-GDS', c1[idx('Prontuario')]);
  verificar('microrganismo entre ~~', c1[idx('Microorganismo')] === 'Klebsiella pneumoniae', c1[idx('Microorganismo')]);
  verificar('antibiograma remontado', c1[idx('Antibiograma')] === 'Piperacilina-Tazobactam: Sensível; Ceftriaxona: Resistente', c1[idx('Antibiograma')]);
  verificar('vigilância positiva → mecanismo carbapenêmicos', c2[idx('Mecanismo')] === 'Resistente a carbapenêmicos', c2[idx('Mecanismo')]);
  verificar('MRSA vira S. aureus + mecanismo', c3[idx('Microorganismo')] === 'Staphylococcus aureus' && c3[idx('Mecanismo')] === 'MRSA', c3[idx('Microorganismo')] + '/' + c3[idx('Mecanismo')]);
  verificar('telefone capturado', c1[idx('Telefone')] === '999185191', c1[idx('Telefone')]);
}

console.log('\n== 14. Unificação de pacientes ==');
{
  verificar('pseudo-prontuário reconhecido', imp.ehPseudoProntuario('07111950-GDS'));
  verificar('prontuário comum não é pseudo', !imp.ehPseudoProntuario('0012345'));
  verificar('registro provisório AT- é pseudo', imp.ehPseudoProntuario('AT-1187195'));
  const pacientes = [
    { Prontuario: '07111950-GDS', Nome: 'Getulio da Silva' },
    { Prontuario: '4455', Nome: 'GETULIO DA SILVA' },
    { Prontuario: '01011990-AL', Nome: 'Ana Lima' },
    { Prontuario: '7788', Nome: 'Ana Lima' },
    { Prontuario: '9900', Nome: 'ANA LIMA' },
    { Prontuario: '02022000-BX', Nome: 'Beto Xavier' }
  ];
  const sug = imp.sugerirUnificacoes(pacientes);
  verificar('sugere por nome igual (caixa diferente)', sug.some(s => s.de === '07111950-GDS' && s.para === '4455'), sug);
  verificar('nome ambíguo (2 candidatos) não sugere', !sug.some(s => s.de === '01011990-AL'), sug);
  verificar('sem correspondente não sugere', !sug.some(s => s.de === '02022000-BX'), sug);
}

console.log('\n== 15. Reimportação de internações (upsert) ==');
{
  const existentes = [
    { ID_Internacao: 'INT-1', Atendimento: '1120208', Prontuario: '2061731', DataInternacao: '2026-01-01', DataAlta: '', Desfecho: '', Obito: 'N', SetorAtual: 'Emergência' },
    { ID_Internacao: 'INT-2', Atendimento: '1120212', Prontuario: '537353', DataInternacao: '2026-01-01', DataAlta: '2026-01-05', Desfecho: 'Alta médica', Obito: 'N', SetorAtual: 'CM' }
  ];
  const reimportados = [
    { Atendimento: '1120208', Prontuario: '2061731', DataInternacao: '2026-01-01', DataAlta: '2026-01-09', Desfecho: 'Óbito', SetorAtual: 'UTI' },
    { Atendimento: '1120212', Prontuario: '537353', DataInternacao: '2026-01-01', DataAlta: '2026-01-05', Desfecho: 'Alta médica', SetorAtual: 'CM' },
    { Atendimento: '9999999', Prontuario: '1', DataInternacao: '2026-02-01', DataAlta: '' }
  ];
  const n = imp.atualizarInternacoesExistentes(existentes, reimportados);
  verificar('só a internação com mudança conta', n === 1, n);
  verificar('alta preenchida na reimportação', existentes[0].DataAlta === '2026-01-09');
  verificar('óbito derivado do desfecho novo', existentes[0].Obito === 'S', existentes[0].Obito);
  verificar('setor atualizado (transferência p/ UTI)', existentes[0].SetorAtual === 'UTI');
  verificar('inalterada permanece igual', existentes[1].DataAlta === '2026-01-05');
}

console.log('\n== 16. Não-cirurgias e nomes padronizados ==');
{
  verificar('parto normal parece não-cirurgia', imp.pareceNaoCirurgia('PARTO NORMAL'));
  verificar('cateterismo parece não-cirurgia', imp.pareceNaoCirurgia('Cateterismo Cardíaco Esquerdo'));
  verificar('colonoscopia parece não-cirurgia', imp.pareceNaoCirurgia('COLONOSCOPIA COM BIÓPSIA'));
  verificar('colecistectomia NÃO parece não-cirurgia', !imp.pareceNaoCirurgia('Colecistectomia Videolaparoscópica'));
  verificar('duplo J NÃO é pré-marcado como não-cirurgia', !imp.pareceNaoCirurgia('Colocação Endoscópica de Cateter Duplo J'));

  const linhas = [
    ['Prontuário', 'Data Cirurgia', 'Procedimento'],
    ['1', '10/08/2026', 'PARTO NORMAL'],
    ['2', '10/08/2026', 'Colocação Endoscópica de Cateter Duplo J à Direita'],
    ['3', '10/08/2026', 'Apendicectomia']
  ];
  const aliases = [
    { Campo: 'procedimentos_nhsn', De: 'PARTO NORMAL', Para: imp.NAO_CIRURGIA },
    { Campo: 'procedimentos_nhsn', De: 'Colocação Endoscópica de Cateter Duplo J à Direita', Para: 'Colocação de duplo J' }
  ];
  const mapa = imp.sugerirMapeamento(linhas[0], linhas.slice(1), 'cirurgias');
  const { registros } = imp.normalizarLinhas(linhas, 0, mapa, 'cirurgias', aliases);
  verificar('sinônimo memorizado marca não-cirurgia', registros[0].Procedimento === imp.NAO_CIRURGIA, registros[0].Procedimento);
  verificar('nome padronizado aplicado (original preservado)',
    registros[1].Procedimento === 'Colocação de duplo J' && registros[1]._originais.Procedimento.includes('Duplo J à Direita'),
    registros[1]);
  const validacao = imp.validar(registros, 'cirurgias', vocabulario);
  verificar('marcador não vira termo novo', !(validacao.termosNovos.procedimentos_nhsn || []).includes(imp.NAO_CIRURGIA), validacao.termosNovos.procedimentos_nhsn);
}

console.log('\n== 17. Dedup de cirurgia renomeada ==');
{
  const existente = [{ Prontuario: '2', DataCirurgia: '2026-08-10', Procedimento: 'Colocação Endoscópica de Cateter Duplo J à Direita', ProcedimentoNHSN: 'Colocação de duplo J' }];
  const reimportado = [{ Prontuario: '2', DataCirurgia: '2026-08-10', Procedimento: 'Colocação de duplo J' }];
  const d = imp.deduplicar(reimportado, existente, 'cirurgias');
  verificar('renomeada não duplica na reimportação', d.novos.length === 0 && d.duplicados.length === 1, d);
}

console.log('\n== 18. Auto-reparo de cirurgias antigas sem identificação ==');
{
  const banco = [
    { ID_Cirurgia: 'CIR-1', Prontuario: '', Atendimento: '1000', DataCirurgia: '2026-08-10', Procedimento: 'Apendicectomia' },
    { ID_Cirurgia: 'CIR-2', Prontuario: '', Atendimento: '9999', DataCirurgia: '2026-08-11', Procedimento: 'Herniorrafia' },
    { ID_Cirurgia: 'CIR-3', Prontuario: '', Atendimento: '', DataCirurgia: '2026-08-12', Procedimento: 'Lixo' },
    { ID_Cirurgia: 'CIR-4', Prontuario: '555', Atendimento: '1000', DataCirurgia: '2026-08-13', Procedimento: 'Colecistectomia' }
  ];
  const internacoes = [{ Atendimento: '1000', Prontuario: '555' }];
  const r = imp.repararCirurgiasSemIdentificacao(banco, internacoes);
  verificar('reparadas 2, removida 1', r.reparadas === 2 && r.removidas === 1, r);
  verificar('atendimento com internação vira prontuário real', r.cirurgias[0].Prontuario === '555');
  verificar('atendimento órfão vira AT-', r.cirurgias[1].Prontuario === 'AT-9999', r.cirurgias[1].Prontuario);
  verificar('irreparável removida', !r.cirurgias.some(x => x.ID_Cirurgia === 'CIR-3'));
  verificar('identificada intocada', r.cirurgias.find(x => x.ID_Cirurgia === 'CIR-4').Prontuario === '555');
  const reimportada = [{ Prontuario: 'AT-9999', DataCirurgia: '2026-08-11', Procedimento: 'Herniorrafia' }];
  const d = imp.deduplicar(reimportada, r.cirurgias, 'cirurgias');
  verificar('após reparo, reimportação não duplica', d.novos.length === 0 && d.duplicados.length === 1, d);
}

console.log('\n== 19. Agrupamento temporal (eventos) ==');
{
  const rel = require(path.join(__dirname, '..', 'js', 'ui-relatorios.js'));
  verificar('chave por dia', rel.chavePeriodo('2026-08-24', 'dia') === '2026-08-24');
  verificar('semana começa na segunda', rel.chavePeriodo('2026-08-24', 'semana') === '2026-08-24' && rel.chavePeriodo('2026-08-26', 'semana') === '2026-08-24', rel.chavePeriodo('2026-08-26', 'semana'));
  verificar('chave por mês', rel.chavePeriodo('2026-08-24', 'mes') === '2026-08');
  verificar('semestres', rel.chavePeriodo('2026-06-30', 'semestre') === '2026-S1' && rel.chavePeriodo('2026-07-01', 'semestre') === '2026-S2');
  verificar('chave por ano', rel.chavePeriodo('2026-08-24', 'ano') === '2026');
  verificar('próximo mês vira ano', rel.proximoPeriodo('2026-12', 'mes') === '2027-01', rel.proximoPeriodo('2026-12', 'mes'));
  verificar('próximo semestre vira ano', rel.proximoPeriodo('2026-S2', 'semestre') === '2027-S1');

  const eventos = [
    { data: '2026-06-10', grupo: 'A' }, { data: '2026-06-20', grupo: 'B' },
    { data: '2026-08-05', grupo: 'A' }, { data: '2026-08-06', grupo: 'A' }
  ];
  const agrupado = rel.agruparEventos(eventos, 'mes');
  verificar('períodos contínuos preenchem julho vazio', agrupado.periodos.join(',') === '2026-06,2026-07,2026-08', agrupado.periodos);
  verificar('série A correta', agrupado.series.get('A').join(',') === '1,0,2', agrupado.series.get('A'));
  verificar('série B correta', agrupado.series.get('B').join(',') === '1,0,0', agrupado.series.get('B'));
  verificar('limite estourado retorna null', rel.agruparEventos([{ data: '2020-01-01' }, { data: '2026-01-01' }], 'dia', 100) === null);
}

console.log('\n== 20. Sugestões de unificação de vocabulário ==');
{
  const termos = ['Enterobacter sp.', 'Enterobacter spp', 'Candida sp.', 'Candida spp',
    'Isolado: Enterobactéria resistente aos carbapenêmicos', 'Enterobactéria resistente aos carbapenêmicos',
    'Enterobactéria resistente aos carbapenêmicos na amostra analisada',
    'Stahpylococcus', 'Staphylococcus spp', 'Escherichia coli', 'escherichia Coli'];
  const oficiais = ['Enterobacter spp', 'Candida spp', 'Staphylococcus spp', 'Escherichia coli'];
  const s = imp.sugerirUnificacoesVocabulario(termos, oficiais);
  const de = nome => (s.find(x => x.de === nome) || {}).para;
  verificar('sp. → spp', de('Enterobacter sp.') === 'Enterobacter spp', de('Enterobacter sp.'));
  verificar('prefixo Isolado: removido', de('Isolado: Enterobactéria resistente aos carbapenêmicos') === 'Enterobactéria resistente aos carbapenêmicos');
  verificar('sufixo na amostra analisada removido', de('Enterobactéria resistente aos carbapenêmicos na amostra analisada') === 'Enterobactéria resistente aos carbapenêmicos');
  verificar('erro de digitação detectado', de('Stahpylococcus') === 'Staphylococcus spp', de('Stahpylococcus'));
  verificar('caixa/acentos iguais unificados', de('escherichia Coli') === 'Escherichia coli', de('escherichia Coli'));
  verificar('oficial não vira sugestão de origem', !s.some(x => x.de === 'Enterobacter spp'), s.map(x => x.de));

  /* A grafia que sobrevive é a correta, não a que vier primeiro na ordem alfabética. */
  const semOficial = imp.sugerirUnificacoesVocabulario(['Escherichia Coli', 'Escherichia coli'], []);
  verificar('mantém nomenclatura binomial', semOficial[0] && semOficial[0].para === 'Escherichia coli', semOficial);
  const comPonto = imp.sugerirUnificacoesVocabulario(['Candida albicans.', 'Candida albicans'], []);
  verificar('descarta ponto final', comPonto[0] && comPonto[0].para === 'Candida albicans', comPonto);
  const empate = imp.sugerirUnificacoesVocabulario(['Staphylococcus coagulase negativo', 'Staphylococcus coagulase-negativo'], [],
    { 'Staphylococcus coagulase-negativo': 732, 'Staphylococcus coagulase negativo': 594 });
  verificar('no empate vence a mais usada', empate[0] && empate[0].para === 'Staphylococcus coagulase-negativo', empate);

  const separado = imp.separarMecanismoDoNome('Enterobactéria resistente aos carbapenêmicos');
  verificar('mecanismo escondido no nome é separado',
    separado && separado.nome === 'Enterobactéria (não identificada)' && separado.mecanismo === 'ERC', separado);
  verificar('nome comum não é mexido', imp.separarMecanismoDoNome('Klebsiella pneumoniae') === null);
}

console.log('\n== 21. Marcador "não é cultura" (bacterioscopias) ==');
{
  const linhas = [['Prontuário', 'Data Coleta', 'Material', 'Microorganismo'],
    ['1', '10/08/2026', 'Escarro', 'Positivo (++)'],
    ['2', '11/08/2026', 'Urocultura', 'Escherichia coli']];
  const aliases = [{ Campo: 'microrganismos', De: 'Positivo (++)', Para: imp.NAO_CULTURA }];
  const mapa = imp.sugerirMapeamento(linhas[0], linhas.slice(1), 'culturas');
  const { registros } = imp.normalizarLinhas(linhas, 0, mapa, 'culturas', aliases);
  verificar('alias aplica o marcador', registros[0].Microrganismo === imp.NAO_CULTURA);
  verificar('original preservado', registros[0]._originais.Microrganismo === 'Positivo (++)');
  const validacao = imp.validar(registros, 'culturas', vocabulario);
  verificar('marcador não vira termo novo', !(validacao.termosNovos.microrganismos || []).includes(imp.NAO_CULTURA));
  const existente = [{ Prontuario: '1', DataColeta: '2026-08-10', Material: 'Escarro', Microrganismo: 'Positivo (++)', StatusRevisao: 'descartada' }];
  const d = imp.deduplicar([registros[0]], existente, 'culturas');
  verificar('reimportação da descartada não duplica', d.novos.length === 0 && d.duplicados.length === 1, d);
}


console.log('\n== 22. Protocolo de sepse (ficha dos enfermeiros) ==');
{
  verificar('sim/não simples', imp.respostaSimNao('NÃO').resposta === 'N' && imp.respostaSimNao('sim').resposta === 'S');
  const comMotivo = imp.respostaSimNao('NÃO, ATRASO NO ATB');
  verificar('justificativa separada da resposta',
    comMotivo.resposta === 'N' && comMotivo.justificativa === 'ATRASO NO ATB', comMotivo);
  verificar('texto sem sim/não não vira resposta', imp.respostaSimNao('Sem Registro').resposta === '');

  verificar('hora da fração do Excel', imp.horaDeFracao(0.415277777777778) === '09:58', imp.horaDeFracao(0.415277777777778));
  verificar('meia-noite', imp.horaDeFracao(0) === '00:00');
  verificar('texto não vira hora', imp.horaDeFracao('não foi adm atb') === '');

  verificar('minutos entre horários', imp.minutosEntre('09:58', '10:14') === 16);
  verificar('etapa que vira o dia', imp.minutosEntre('23:40', '00:20') === 40);
  verificar('diferença absurda é descartada', imp.minutosEntre('08:00', '23:00') === '');

  verificar('setor normalizado', ['SETOR 05', 'Setor  5', 'setor 5'].every(s => imp.setorDeSepse(s) === 'Setor 5'));
  verificar('desfecho normalizado', imp.desfechoDeSepse('INTRENADO') === 'Internação'
    && imp.desfechoDeSepse('òbito') === 'Óbito' && imp.desfechoDeSepse('Internação/ UTI') === 'UTI');
  verificar('transferência para UTI externa é transferência',
    imp.desfechoDeSepse('Transf UTI externa') === 'Transferência');
  verificar('foco normalizado', imp.focoDeSepse('FOCO PULMONAR') === 'Pulmonar'
    && imp.focoDeSepse('Pumonar') === 'Pulmonar' && imp.focoDeSepse('PIELONEFRITE') === 'Urinário');
  verificar('sepse descartada reconhecida', imp.focoDeSepse('não confirmado') === 'Sepse descartada');

  verificar('conduta no lugar da hora', imp.situacaoAntibiotico('não foi adm atb') === 'Não administrado'
    && imp.situacaoAntibiotico('MANTEVE') === 'Mantido o mesmo antibiótico'
    && imp.situacaoAntibiotico('Ceftriaxona') === 'Antibiótico registrado sem horário');

  const linha = { HoraNEWS: '09:00', HoraNEWSEnf: '09:10', HoraPrescricaoEnf: '09:25', HoraChegadaMedico: '09:40', HoraAntibiotico: '10:05' };
  imp.enriquecerSepse(linha, ['Bundle completo: ATRASO NO ATB', 'Bundle completo: ATRASO NO ATB']);
  verificar('tempos calculados dos horários',
    linha.MinutosReavaliacaoNEWS === 10 && linha.MinutosPrescricao === 15
    && linha.MinutosChegadaMedico === 40 && linha.MinutosAntibiotico === 65, linha);
  verificar('justificativa repetida não duplica', linha.MotivoNaoConformidade === 'Bundle completo: ATRASO NO ATB');
}
console.log('\n== 23. Sepse × culturas (perfil microbiológico por sítio) ==');
{
  /* As funções vivem em js/ui-sepse.js, que é código de tela; aqui são reimplementadas
     as duas regras puras para travar o comportamento esperado. */
  const origemDaCultura = cultura => {
    const c = String(cultura.AvaliacaoCCIH || '').trim();
    if (/^IRAS/i.test(c) || c === 'Bacteremia secundária') return 'IRAS';
    if (c === 'Presente na admissão') return 'Admissão';
    if (!c || cultura.StatusRevisao === 'pendente') return 'Não classificada';
    return 'Outra classificação';
  };
  verificar('IRAS com topografia continua IRAS', origemDaCultura({ AvaliacaoCCIH: 'IRAS — PAV' }) === 'IRAS');
  verificar('bacteremia secundária conta como IRAS', origemDaCultura({ AvaliacaoCCIH: 'Bacteremia secundária' }) === 'IRAS');
  verificar('presente na admissão separado', origemDaCultura({ AvaliacaoCCIH: 'Presente na admissão' }) === 'Admissão');
  verificar('contaminação não entra no perfil', origemDaCultura({ AvaliacaoCCIH: 'Contaminação' }) === 'Outra classificação');
  verificar('pendente é não classificada', origemDaCultura({ AvaliacaoCCIH: '', StatusRevisao: 'pendente' }) === 'Não classificada');

  const dentroDaJanela = (dataProtocolo, dataColeta, janela) => {
    const dias = (Date.parse(dataColeta + 'T00:00:00Z') - Date.parse(dataProtocolo + 'T00:00:00Z')) / 86400000;
    return dias >= -janela && dias <= janela;
  };
  verificar('cultura do mesmo dia entra', dentroDaJanela('2026-05-10', '2026-05-10', 3));
  verificar('cultura 3 dias antes entra', dentroDaJanela('2026-05-10', '2026-05-07', 3));
  verificar('cultura de outro episódio fica fora', !dentroDaJanela('2026-05-10', '2026-06-20', 3));
}

console.log('\n== 24. Investigação de surtos ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const culturas = [
    { ID_Cultura: 'C1', Prontuario: '101', DataColeta: '2026-08-01', Setor: 'CTI', Material: 'Hemocultura', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'ERC' },
    { ID_Cultura: 'C2', Prontuario: '102', DataColeta: '2026-08-04', Setor: 'CTI', Material: 'Hemocultura', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'ERC' },
    { ID_Cultura: 'C3', Prontuario: '103', DataColeta: '2026-08-09', Setor: 'CTI', Material: 'Ponta de cateter', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'ERC' }
  ];
  const surtos = alertas.detectarSurtos(culturas);
  verificar('suspeita detectada com os prontuários', surtos.length === 1 && surtos[0].Prontuarios.length === 3, surtos[0]);
  verificar('culturas da suspeita vêm junto', surtos[0].Culturas.length === 3, surtos[0].Culturas);

  const investigacao = { Setor: 'CTI', Microrganismo: 'Klebsiella pneumoniae', DataInicio: '2026-08-01', DataFim: '2026-08-09' };
  verificar('mesma suspeita é reconhecida', alertas.mesmaSuspeita(surtos[0], investigacao));
  verificar('período distante não é a mesma suspeita',
    !alertas.mesmaSuspeita(surtos[0], { ...investigacao, DataInicio: '2025-01-01', DataFim: '2025-01-10' }));
  verificar('outro germe não é a mesma suspeita',
    !alertas.mesmaSuspeita(surtos[0], { ...investigacao, Microrganismo: 'Escherichia coli' }));

  const correlacao = alertas.correlacionarSurto(surtos[0].Prontuarios, {
    internacoes: [
      { Prontuario: '101', DataInternacao: '2026-07-28', DataAlta: '2026-08-15', SetorAtual: 'CTI', Leito: '7' },
      { Prontuario: '102', DataInternacao: '2026-07-30', DataAlta: '2026-08-20', SetorAtual: 'CTI', Leito: '7' },
      { Prontuario: '103', DataInternacao: '2026-08-02', DataAlta: '', SetorAtual: 'CTI', Leito: '9' },
      { Prontuario: '999', DataInternacao: '2026-08-01', DataAlta: '2026-08-30', SetorAtual: 'CTI', Leito: '7' }
    ],
    cirurgias: [
      { Prontuario: '101', ProcedimentoNHSN: 'Cirurgia cardíaca', Cirurgiao: 'Dr. X' },
      { Prontuario: '102', ProcedimentoNHSN: 'Cirurgia cardíaca', Cirurgiao: 'Dr. X' },
      { Prontuario: '103', ProcedimentoNHSN: 'Colecistectomia', Cirurgiao: 'Dr. Y' }
    ],
    dispositivos: [{ Prontuario: '101', Categoria: 'CVC' }, { Prontuario: '102', Categoria: 'CVC' }],
    culturas
  });
  verificar('leito compartilhado é encontrado',
    correlacao.leitos.length === 1 && correlacao.leitos[0].valor === '7' && correlacao.leitos[0].pacientes === 2, correlacao.leitos);
  verificar('paciente de fora do surto não entra na conta',
    !correlacao.pacientes.includes('999') && correlacao.totais.internacoes === 3, correlacao.totais);
  verificar('procedimento comum encontrado',
    correlacao.procedimentos.length === 1 && correlacao.procedimentos[0].pacientes === 2, correlacao.procedimentos);
  verificar('cirurgia de um paciente só não vira coincidência',
    !correlacao.procedimentos.some(p => p.valor === 'Colecistectomia'));
  verificar('internações simultâneas detectadas', correlacao.sobreposicoes.length === 3, correlacao.sobreposicoes.length);
  verificar('mecanismo comum aos três', correlacao.mecanismos[0].pacientes === 3, correlacao.mecanismos);
}

console.log('\n== 25. Reimportação de exportação do próprio banco ==');
{
  const registros = [
    { IDOrigem: '90000131', Prontuario: '5415329', DataColeta: '2021-10-26', Material: 'Swab de vigilância', Microrganismo: 'Staphylococcus aureus' },
    { IDOrigem: '', Prontuario: '999', DataColeta: '2026-07-15', Material: 'Urocultura', Microrganismo: 'Escherichia coli' }
  ];
  const existentes = registros.map(r => ({ ...r }));
  /* mesma cultura voltando com o NOSSO código no lugar do ID do laboratório */
  const reimportada = { IDOrigem: 'CUL-000001', Prontuario: '999', DataColeta: '2026-07-15', Material: 'Urocultura', Microrganismo: 'Escherichia coli' };
  const dedup = imp.deduplicar([reimportada], existentes, 'culturas');
  verificar('ID do próprio banco não vale como identidade de origem',
    dedup.duplicados.length === 1 && dedup.novos.length === 0, dedup.novos);
  /* ID de laboratório de verdade continua sendo a identidade */
  const outroExame = { IDOrigem: '90000132', Prontuario: '5415329', DataColeta: '2021-10-26', Material: 'Swab de vigilância', Microrganismo: 'Staphylococcus aureus' };
  const dedup2 = imp.deduplicar([outroExame], existentes, 'culturas');
  verificar('exame distinto com ID do laboratório continua entrando',
    dedup2.novos.length === 1, dedup2.duplicados);
}

console.log('\n== 26. Laudo do laboratório com número de internação (a partir de set/2026) ==');
{
  const comNumero = [
    'O.S.: 050-1  Data: 02/09/2026 09:10:00   Paciente: Getulio da Silva',
    'Sexo: Masculino  Idade: 75 anos   Data nasc.: 07/11/1950   Unidade coleta: H UNID 05 (HNSC)',
    'Atendimento: 1234567   Telefone:999185191',
    'Procedimento: CULT - UROCULTURA',
    'Material:      Urina amostra isolada       Data coleta: 02/09/2026 10:00:00',
    'Grupo: BGN     Resultado:   ~Escherichia coli~'
  ];
  const aoa = imp.analisarPDFCulturas(comNumero);
  verificar('usa o número informado como prontuário', aoa[1][0] === '1234567', aoa[1][0]);
  verificar('nome do paciente preservado', aoa[1][1] === 'Getulio da Silva');

  /* o laudo antigo, sem número, continua caindo no registro provisório */
  const semNumero = comNumero.filter(l => !/^Atendimento:/.test(l));
  const aoa2 = imp.analisarPDFCulturas(semNumero);
  verificar('sem número, mantém o registro provisório', aoa2[1][0] === '07111950-GDS', aoa2[1][0]);

  /* outros rótulos que o laboratório pode usar */
  for (const rotulo of ['Prontuário: 987654', 'Prontuario nº 987654', 'Internação: 987654', 'Registro do paciente: 987654']) {
    const linhas = comNumero.map(l => /^Atendimento:/.test(l) ? rotulo + '   Telefone:999185191' : l);
    const r = imp.analisarPDFCulturas(linhas);
    verificar(`rótulo "${rotulo.split(':')[0].split(' ')[0]}" reconhecido`, r[1][0] === '987654', r[1][0]);
  }

  /* o número da ordem de serviço não pode ser confundido com o do paciente */
  verificar('O.S. não vira prontuário', imp.analisarPDFCulturas(semNumero)[1][0] !== '050');
}

console.log('\n== 27. Vincular exame à internação que cobre a data ==');
{
  /* A mesma pessoa tem um número por internação — casar só por nome é ambíguo. */
  const pacientes = [
    { Prontuario: '1000', Nome: 'Maria da Silva' },
    { Prontuario: '2000', Nome: 'Maria da Silva' },
    { Prontuario: '3000', Nome: 'Maria da Silva' },
    { Prontuario: '4000', Nome: 'Outro Paciente' }
  ];
  const internacoes = [
    { Prontuario: '1000', DataInternacao: '2026-01-10', DataAlta: '2026-01-20' },
    { Prontuario: '2000', DataInternacao: '2026-05-01', DataAlta: '2026-05-30' },
    { Prontuario: '3000', DataInternacao: '2026-08-01', DataAlta: '' },
    { Prontuario: '4000', DataInternacao: '2026-05-05', DataAlta: '2026-05-10' }
  ];
  const indice = imp.indicePorNome(pacientes, internacoes);
  const resolver = (nome, data) => imp.resolverPorNomeEData(nome, data, indice);

  verificar('escolhe a internação que cobre a coleta',
    resolver('Maria da Silva', '2026-05-12').prontuario === '2000', resolver('Maria da Silva', '2026-05-12'));
  verificar('internação ainda aberta também vale',
    resolver('Maria da Silva', '2026-08-20').prontuario === '3000');
  verificar('coleta no dia da alta entra pela folga',
    resolver('Maria da Silva', '2026-01-21').prontuario === '1000');
  verificar('coleta fora de qualquer internação não é chutada',
    resolver('Maria da Silva', '2026-03-15').prontuario === ''
    && resolver('Maria da Silva', '2026-03-15').motivo === 'nenhuma internação cobre a data');
  verificar('nome desconhecido não resolve',
    resolver('Fulano Inexistente', '2026-05-12').motivo === 'nome sem correspondência');
  verificar('homônimo de outra pessoa não interfere',
    resolver('Outro Paciente', '2026-05-07').prontuario === '4000');

  /* duas internações cobrindo a mesma data: melhor não escolher */
  const ambiguo = imp.indicePorNome(
    [{ Prontuario: '5000', Nome: 'Ana' }, { Prontuario: '6000', Nome: 'Ana' }],
    [{ Prontuario: '5000', DataInternacao: '2026-02-01', DataAlta: '2026-02-28' },
     { Prontuario: '6000', DataInternacao: '2026-02-10', DataAlta: '2026-02-20' }]);
  const r = imp.resolverPorNomeEData('Ana', '2026-02-15', ambiguo);
  verificar('sobreposição de internações fica sem decisão',
    r.prontuario === '' && r.motivo === 'mais de uma internação na data', r);
}

console.log('\n== 28. Janela do painel × janela do isolamento ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const hoje = '2026-08-29';
  const diasAtras = n => new Date(Date.parse(hoje + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  const culturas = [
    { ID_Cultura: 'A', Prontuario: '1', DataColeta: diasAtras(3), Setor: 'CTI', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'ERC' },
    { ID_Cultura: 'B', Prontuario: '2', DataColeta: diasAtras(9), Setor: 'CTI', Microrganismo: 'Staphylococcus aureus', MecanismoResistencia: 'MRSA' },
    { ID_Cultura: 'C', Prontuario: '3', DataColeta: diasAtras(11), Setor: 'CTI', Microrganismo: 'Acinetobacter', MecanismoResistencia: 'CRAb' },
    { ID_Cultura: 'D', Prontuario: '4', DataColeta: diasAtras(25), Setor: 'CTI', Microrganismo: 'Enterococcus', MecanismoResistencia: 'VRE' }
  ];
  verificar('painel mostra só os 10 dias',
    alertas.detectarMultirresistentes(culturas, [], hoje, 10).length === 2,
    alertas.detectarMultirresistentes(culturas, [], hoje, 10).map(m => m.Mecanismo));
  verificar('pendência de isolamento continua olhando 30 dias (pega os quatro)',
    alertas.detectarMultirresistentes(culturas, [], hoje, 30).length === 4,
    alertas.detectarMultirresistentes(culturas, [], hoje, 30).length);
  verificar('o mais recente vem primeiro',
    alertas.detectarMultirresistentes(culturas, [], hoje, 10)[0].Mecanismo === 'ERC');
}

console.log('\n== 29. Ficha do paciente (juntar atendimentos) ==');
{
  /* A pessoa tem um número por internação; a ficha precisa juntá-los para contar a
     história inteira. A regra vive em ui-paciente.js (código de tela) e é reproduzida
     aqui para travar o comportamento. */
  const atendimentosDaPessoa = (prontuario, pacientes) => {
    const alvo = imp.normalizarProntuario(prontuario);
    const registro = pacientes.find(p => imp.normalizarProntuario(p.Prontuario) === alvo);
    const nome = leitura.normalizarTexto(registro && registro.Nome);
    if (!nome) return [alvo];
    return [...new Set(pacientes.filter(p => leitura.normalizarTexto(p.Nome) === nome)
      .map(p => imp.normalizarProntuario(p.Prontuario)))];
  };
  const pacientes = [
    { Prontuario: '900100', Nome: 'Maria das Dores' },
    { Prontuario: '900200', Nome: 'Maria das Dores' },
    { Prontuario: '900300', Nome: 'Outra Pessoa' },
    { Prontuario: '900400', Nome: '' }
  ];
  verificar('junta os atendimentos da mesma pessoa',
    atendimentosDaPessoa('900100', pacientes).join(',') === '900100,900200',
    atendimentosDaPessoa('900100', pacientes));
  verificar('não mistura homônimo diferente',
    !atendimentosDaPessoa('900100', pacientes).includes('900300'));
  verificar('paciente sem nome fica só com o próprio número',
    atendimentosDaPessoa('900400', pacientes).join(',') === '900400');
  verificar('prontuário desconhecido não quebra',
    atendimentosDaPessoa('999999', pacientes).join(',') === '999999');
}

console.log('\n== 30. Identificar o paciente pelo número anotado à beira do leito ==');
{
  /* O hospital usa dois números: prontuário (da pessoa) e atendimento (da internação).
     Quem anota na visita informa o que está na pulseira — pode ser qualquer um dos dois. */
  const pacientes = [
    { Prontuario: '537353', Nome: 'Joana Ribeiro' },
    { Prontuario: '1120212', Nome: 'Joana Ribeiro' },
    { Prontuario: '900001', Nome: 'Paciente Antigo' }
  ];
  const internacoes = [
    { Prontuario: '537353', Atendimento: '1120212', DataInternacao: '2026-07-01', DataAlta: '' },
    { Prontuario: '900001', Atendimento: '800001', DataInternacao: '2026-01-05', DataAlta: '2026-01-20' },
    { Prontuario: '900001', Atendimento: '800002', DataInternacao: '2026-06-10', DataAlta: '2026-06-30' }
  ];
  const indice = imp.indiceDeIdentificacao(pacientes, internacoes);

  const pelaFicha = imp.identificarPaciente('537353', '2026-07-09', indice);
  verificar('acha pelo prontuário do cadastro', pelaFicha.encontrado && pelaFicha.nome === 'Joana Ribeiro', pelaFicha);

  const peloAtendimento = imp.identificarPaciente('1120212', '2026-07-09', indice);
  verificar('acha pelo número do atendimento', peloAtendimento.encontrado && peloAtendimento.nome === 'Joana Ribeiro', peloAtendimento);

  const desconhecido = imp.identificarPaciente('999999', '2026-07-09', indice);
  verificar('número fora do banco devolve não encontrado',
    !desconhecido.encontrado && desconhecido.origem === 'não encontrado', desconhecido);
  verificar('sem número não quebra', imp.identificarPaciente('', '2026-07-09', indice).encontrado === false);

  /* Com várias internações, vale a que cobre a data do registro. */
  const naPrimeira = imp.identificarPaciente('900001', '2026-01-10', indice);
  verificar('escolhe a internação que cobre a data',
    naPrimeira.internacao && naPrimeira.internacao.Atendimento === '800001', naPrimeira.internacao);
  const naSegunda = imp.identificarPaciente('900001', '2026-06-15', indice);
  verificar('outra data leva à outra internação',
    naSegunda.internacao && naSegunda.internacao.Atendimento === '800002', naSegunda.internacao);
  const foraDeTudo = imp.identificarPaciente('900001', '2026-03-01', indice);
  verificar('data fora das internações ainda identifica a pessoa',
    foraDeTudo.encontrado && foraDeTudo.nome === 'Paciente Antigo', foraDeTudo);
}

console.log('\n== 31. Triagem automática das culturas ==');
{
  const t = c => imp.preClassificarCultura(c);
  verificar('cultura sem crescimento é negativa',
    t({ Material: 'Hemocultura', Resultado: 'Negativa', Microrganismo: '' }) === 'Negativa');
  verificar('resultado vazio e sem germe também é negativa',
    t({ Material: 'Urocultura', Resultado: '', Microrganismo: '' }) === 'Negativa');
  verificar('swab de vigilância que cresceu é colonização',
    t({ Material: 'Swab de vigilância', Sitio: 'Pele e Partes Moles', Resultado: 'Positiva', Microrganismo: 'Escherichia coli' }) === 'Colonização');
  verificar('swab nasal é colonização',
    t({ Material: 'Swab nasal', Resultado: 'Positiva', Microrganismo: 'Staphylococcus aureus' }) === 'Colonização');
  verificar('swab retal é colonização',
    t({ Material: 'Swab retal de vigilância', Resultado: 'Positiva', Microrganismo: 'Klebsiella pneumoniae' }) === 'Colonização');
  verificar('swab vaginal de SGB é colonização',
    t({ Material: 'Swab vaginal (pesquisa de SGB)', Resultado: 'Positiva', Microrganismo: 'Streptococcus agalactiae' }) === 'Colonização');
  verificar('swab que não cresceu é negativa, não colonização',
    t({ Material: 'Swab de vigilância', Resultado: 'Negativa', Microrganismo: '' }) === 'Negativa');
  verificar('leite materno vira Leite mesmo com crescimento',
    t({ Material: 'Leite materno', Resultado: 'Positiva', Microrganismo: 'Staphylococcus epidermidis' }) === 'Leite');
  verificar('leite pelo sítio de controle',
    t({ Material: 'Outros', Sitio: 'Leite humano (controle)', Resultado: 'Negativa', Microrganismo: '' }) === 'Leite');
  verificar('água vira Água', t({ Material: 'Água de osmose reversa', Resultado: 'Positiva', Microrganismo: 'Pseudomonas' }) === 'Água');
  verificar('hemocultura positiva fica para a CCIH decidir',
    t({ Material: 'Hemocultura', Resultado: 'Positiva', Microrganismo: 'Staphylococcus aureus' }) === '');

  /* A triagem entra pela importação e marca status 'triagem', não 'avaliada'. */
  const linha = imp.montarLinhaImportada(
    { Prontuario: '1', DataColeta: '2026-08-01', Material: 'Hemocultura', Resultado: 'Negativa', Microrganismo: '' },
    'culturas', 'CUL-1', 'teste', '2026-08-01 10:00');
  verificar('importação classifica a negativa sozinha',
    linha.AvaliacaoCCIH === 'Negativa' && linha.StatusRevisao === 'triagem', linha.StatusRevisao);
  const pendente = imp.montarLinhaImportada(
    { Prontuario: '1', DataColeta: '2026-08-01', Material: 'Hemocultura', Resultado: 'Positiva', Microrganismo: 'Escherichia coli' },
    'culturas', 'CUL-2', 'teste', '2026-08-01 10:00');
  verificar('positiva de sítio estéril continua pendente', pendente.StatusRevisao === 'pendente', pendente.StatusRevisao);
  /* Classificação vinda no relatório manda mais que a triagem. */
  const daCCIH = imp.montarLinhaImportada(
    { Prontuario: '1', DataColeta: '2026-08-01', Material: 'Swab de vigilância', Resultado: 'Positiva',
      Microrganismo: 'Klebsiella pneumoniae', AvaliacaoCCIH: 'IRAS' },
    'culturas', 'CUL-3', 'teste', '2026-08-01 10:00');
  verificar('classificação humana no relatório vence a triagem',
    daCCIH.AvaliacaoCCIH === 'IRAS' && daCCIH.StatusRevisao === 'avaliada', daCCIH);

  verificar('triagem sai do painel', imp.culturaDoPainel(linha) === false);
  verificar('pendente positiva entra no painel', imp.culturaDoPainel(pendente) === true);
  verificar('IRAS entra no painel', imp.culturaDoPainel(daCCIH) === true);
  verificar('descartada não entra no painel',
    imp.culturaDoPainel({ StatusRevisao: 'descartada', Microrganismo: 'X' }) === false);
}

console.log('\n== 32. Culturas do protocolo de sepse ==');
{
  const indice = imp.indiceSepse([
    { Prontuario: '500', DataProtocolo: '2026-05-10' },
    { Prontuario: '500', DataProtocolo: '2026-09-01' }
  ]);
  const de = (p, d) => imp.culturaDeProtocoloSepse({ Prontuario: p, DataColeta: d }, indice);
  verificar('cultura no dia do protocolo é marcada', de('500', '2026-05-10') === true);
  verificar('cultura 3 dias depois ainda é do protocolo', de('500', '2026-05-13') === true);
  verificar('cultura 2 dias antes ainda é do protocolo', de('500', '2026-05-08') === true);
  verificar('cultura 10 dias depois já é outro episódio', de('500', '2026-05-20') === false);
  verificar('o segundo protocolo também vale', de('500', '2026-09-02') === true);
  verificar('outro paciente não é marcado', de('501', '2026-05-10') === false);
}

console.log('\n== 33. Relatório impresso: setor em faixa e quebra de página ==');
{
  /* Reproduz o formato do relatório de isolados: título, cabeçalho, faixas de setor,
     e uma linha partida ao meio pela quebra de página (a precaução do 2º paciente cai
     depois do cabeçalho repetido). */
  const linhas = [
    ['HNSC - Pacientes Isolados', '', '', '', '', '', ''],
    ['', '', '', '< < <  31/08/2026 11:36:52  > > >', '', '', ''],
    ['', '', 'Atendimento', 'Leito', 'Paciente', 'Precaucão', 'Motivo Isolamento'],
    ['', 'CTI', '', '', '', '', ''],
    ['', '', '111', '11', 'Ana Souza', 'Precaução de Contato', 'Bactéria resistente'],
    ['', '', '222', '12', 'Bruno Lima', '', ''],
    ['Impresso em: 31/08/2026', '', '', 'Página 1', '', '', ''],
    ['HNSC - Pacientes Isolados', '', '', '', '', '', ''],
    ['', '', '', '< < <  31/08/2026 11:36:52  > > >', '', '', ''],
    ['', '', 'Atendimento', 'Leito', 'Paciente', 'Precaucão', 'Motivo Isolamento'],
    ['', '', '', '', '', 'Precaução de Aerossóis', 'Tuberculose Notificada'],
    ['', 'Pediatria', '', '', '', '', ''],
    ['', '', '333', '05', 'Caio Melo', 'Precaução de Gotículas', 'Vírus Influenza']
  ];
  const mapa = [
    { coluna: 2, cabecalho: 'Atendimento', destino: 'Prontuario' },
    { coluna: 3, cabecalho: 'Leito', destino: 'Leito' },
    { coluna: 4, cabecalho: 'Paciente', destino: 'NomePaciente' },
    { coluna: 5, cabecalho: 'Precaucão', destino: 'TipoPrecaucao' },
    { coluna: 6, cabecalho: 'Motivo Isolamento', destino: 'Motivo' }
  ];
  const r = imp.normalizarLinhas(linhas, 2, mapa, 'isolamentos', []);
  verificar('3 pacientes, sem linhas-fantasma', r.registros.length === 3, r.registros.length);
  verificar('setor vem da faixa acima do grupo',
    r.registros[0].Setor === 'CTI' && r.registros[2].Setor === 'Pediatria',
    r.registros.map(x => x.Setor));
  verificar('faixa nova troca o setor do grupo seguinte', r.registros[1].Setor === 'CTI', r.registros[1].Setor);
  /* O rabicho da linha partida volta para o paciente certo. */
  verificar('linha partida pela quebra de página é remendada',
    r.registros[1].Prontuario === '222' && r.registros[1].TipoPrecaucao === 'Precaução de Aerossóis'
    && r.registros[1].Motivo === 'Tuberculose Notificada', r.registros[1]);
  verificar('título e cabeçalho repetidos não viram registro nem setor',
    !r.registros.some(x => /HNSC|Atendimento/.test(x.Setor + x.NomePaciente)), r.registros.map(x => x.Setor));

  const gerar = imp.proximoID([], 'ID_Precaucao', 'PRE');
  const gravadas = r.registros.map(x => imp.montarLinhaImportada(x, 'isolamentos', gerar(), 't', '2026-08-31 12:00'));
  verificar('precaução vira forma canônica',
    gravadas.map(g => g.TipoPrecaucao).join(',') === 'Contato,Aerossóis,Gotículas',
    gravadas.map(g => g.TipoPrecaucao));
  verificar('entra como isolamento ativo', gravadas.every(g => g.Status === 'ativo' && g.DataFim === ''));
  /* Reimportar o mesmo arquivo não pode duplicar: a chave compara valores já canônicos. */
  const dedup = imp.deduplicar(r.registros, gravadas, 'isolamentos');
  verificar('reimportar a mesma foto não duplica',
    dedup.novos.length === 0 && dedup.duplicados.length === 3, dedup.novos.length);

  verificar('data da foto sai do enfeite acima do cabeçalho',
    imp.dataDoRelatorio(linhas, 2) === '2026-08-31', imp.dataDoRelatorio(linhas, 2));

  /* Quem importa mapeia a coluna da faixa como Setor — a faixa tem de continuar sendo
     faixa, e não virar continuação da linha de cima (o bug que deslocou os setores). */
  const mapaComSetor = mapa.concat([{ coluna: 1, cabecalho: '', destino: 'Setor' }]);
  const r2 = imp.normalizarLinhas(linhas, 2, mapaComSetor, 'isolamentos', []);
  verificar('faixa mapeada como Setor não desloca os setores',
    r2.registros.map(x => x.Setor).join('|') === 'CTI|CTI|Pediatria',
    r2.registros.map(x => x.Setor));
  verificar('faixa mapeada não engole pacientes', r2.registros.length === 3, r2.registros.length);
}

console.log('\n== 34. Isolamento é foto do momento: quem sumiu, encerrou ==');
{
  const banco = [
    { Prontuario: '111', TipoPrecaucao: 'Contato', DataInicio: '2026-08-20', DataFim: '', Status: 'ativo' },
    { Prontuario: '999', TipoPrecaucao: 'Contato', DataInicio: '2026-08-15', DataFim: '', Status: 'ativo' },
    { Prontuario: '888', TipoPrecaucao: 'Gotículas', DataInicio: '2026-08-10', DataFim: '2026-08-12', Status: 'encerrado' }
  ];
  const naFoto = [{ Prontuario: '111', TipoPrecaucao: 'Precaução de Contato' }];
  const n = imp.encerrarIsolamentosAusentes(banco, naFoto, '2026-08-31');
  verificar('encerra só quem sumiu da foto', n === 1, n);
  verificar('quem continua na foto segue ativo',
    banco[0].Status === 'ativo' && banco[0].VistoEm === '2026-08-31', banco[0]);
  verificar('quem sumiu ganha data de fim',
    banco[1].Status === 'encerrado' && banco[1].DataFim === '2026-08-31', banco[1]);
  verificar('já encerrado não é mexido', banco[2].DataFim === '2026-08-12');

  /* Foto velha não pode desligar isolamento que começou depois dela. */
  const banco2 = [{ Prontuario: '777', TipoPrecaucao: 'Contato', DataInicio: '2026-08-30', DataFim: '', Status: 'ativo' }];
  verificar('foto antiga não encerra isolamento aberto depois',
    imp.encerrarIsolamentosAusentes(banco2, [], '2026-08-20') === 0 && banco2[0].Status === 'ativo');
  verificar('sem data da foto não encerra nada',
    imp.encerrarIsolamentosAusentes(banco2, [], '') === 0);

  /* Precaução registrada NO APP nascia sem Status e virava "isolada eterna" — a foto
     nunca a encerrava e todo MDR parecia isolado para sempre. */
  const banco3 = [
    { ID_Precaucao: 'PRC-000001', Prontuario: '555', TipoPrecaucao: 'Contato', DataInicio: '2026-08-10', DataFim: '', Status: '' },
    { ID_Precaucao: 'PRC-000002', Prontuario: '666', TipoPrecaucao: 'Contato', DataInicio: '2026-08-11', DataFim: '', Status: '' }
  ];
  const n3 = imp.encerrarIsolamentosAusentes(banco3, [{ Prontuario: '666', TipoPrecaucao: 'Contato' }], '2026-09-01');
  verificar('precaução do app (Status vazio) ausente da foto É encerrada',
    n3 === 1 && banco3[0].Status === 'encerrado' && banco3[0].DataFim === '2026-09-01', JSON.stringify(banco3[0]));
  verificar('precaução do app presente na foto ganha VistoEm e segue',
    !banco3[1].DataFim && banco3[1].VistoEm === '2026-09-01', JSON.stringify(banco3[1]));
}

console.log('\n== 35. Higiene das mãos: adesão em duas informações ==');
{
  verificar('álcool = higienizou com álcool',
    imp.adesaoHigiene('Álcool').acao === 'Higienizou' && imp.adesaoHigiene('Álcool').tipo === 'Álcool');
  verificar('sabonete = higienizou com sabonete',
    imp.adesaoHigiene('Sabonete').acao === 'Higienizou' && imp.adesaoHigiene('Sabonete').tipo === 'Sabonete');
  verificar('perdida = não higienizou', imp.adesaoHigiene('Perdida').acao === 'Não higienizou');
  verificar('redação desconhecida não inventa adesão',
    imp.adesaoHigiene('Luva sem higienizar').acao === '', imp.adesaoHigiene('Luva sem higienizar'));

  /* Duas observações idênticas no mesmo dia são duas oportunidades, não uma repetida. */
  const linhas = [
    ['Data', 'Setor', 'Turno', 'Profissional', 'Momento', 'Adesão'],
    ['2026-07-31', 'UTI', 'Dia', 'Técnico Enfermagem', 'Antes do contato com paciente', 'Álcool'],
    ['2026-07-31', 'UTI', 'Dia', 'Técnico Enfermagem', 'Antes do contato com paciente', 'Álcool'],
    ['2026-07-31', 'UTI', 'Dia', 'Fisioterapeuta', 'Antes do contato com paciente', 'Perdida']
  ];
  const mapa = ['Data', 'Setor', 'Turno', 'Categoria', 'Momento', 'Adesao']
    .map((destino, coluna) => ({ coluna, cabecalho: linhas[0][coluna], destino }));
  const r = imp.normalizarLinhas(linhas, 0, mapa, 'higiene_maos', []);
  verificar('as 3 observações são mantidas', r.registros.length === 3, r.registros.length);
  verificar('repetições legítimas são numeradas',
    r.registros.map(x => x.Ocorrencia).join(',') === '1,2,1', r.registros.map(x => x.Ocorrencia));

  const gerar = imp.proximoID([], 'ID_Observacao', 'HIG');
  const gravadas = r.registros.map(x => imp.montarLinhaImportada(x, 'higiene_maos', gerar(), 't', '2026-08-31 12:00'));
  verificar('ação e insumo ficam em campos separados',
    gravadas[0].Acao === 'Higienizou' && gravadas[0].TipoHigienizacao === 'Álcool'
    && gravadas[2].Acao === 'Não higienizou' && gravadas[2].TipoHigienizacao === '', gravadas[2]);
  verificar('a coluna crua Adesao não vai para o banco', gravadas[0].Adesao === undefined);
  const dedup = imp.deduplicar(r.registros, gravadas, 'higiene_maos');
  verificar('reimportar o mesmo arquivo não duplica nem perde a repetição',
    dedup.novos.length === 0 && dedup.duplicados.length === 3, dedup.novos.length);
  /* Um lote novo com as mesmas características entra — a numeração recomeça, mas a
     comparação é contra o banco, que já tem Ocorrencia 1 e 2 daquele dia. */
  const soUma = imp.normalizarLinhas(linhas.slice(0, 2), 0, mapa, 'higiene_maos', []);
  verificar('observação já gravada continua sendo duplicada',
    imp.deduplicar(soUma.registros, gravadas, 'higiene_maos').novos.length === 0);
}

console.log('\n== 36. Miniapp e Vigispec falam o mesmo idioma ==');
{
  /* O miniapp grava Acao=insumo, TipoHigienizacao=técnica, Momento=número da OMS. */
  const doCelular = imp.normalizarObservacaoHigiene({
    ID_Observacao: '1787147152749-7633', Data: '2026-08-19', Setor: 'Uti', Observador: 'Renata',
    TipoHigienizacao: 'Simples', Categoria: 'Técnico de enfermagem', Momento: '3',
    Acao: 'Água e sabão', DuracaoSegundos: '5'
  });
  verificar('insumo do miniapp vira ação + insumo',
    doCelular.Acao === 'Higienizou' && doCelular.TipoHigienizacao === 'Sabonete', doCelular);
  verificar('a técnica não ocupa o lugar do insumo', doCelular.Tecnica === 'Simples', doCelular.Tecnica);
  verificar('número do momento vira a frase da OMS',
    doCelular.Momento === 'Após risco de exposição a fluidos corporais', doCelular.Momento);
  verificar('categoria do miniapp casa com a do Vigispec',
    doCelular.Categoria === 'Técnico Enfermagem', doCelular.Categoria);

  const naoHigienizou = imp.normalizarObservacaoHigiene({
    TipoHigienizacao: 'Simples', Momento: '1', Acao: 'Não higienizou', Categoria: 'Médico'
  });
  verificar('"não higienizou" continua não higienizou',
    naoHigienizou.Acao === 'Não higienizou' && naoHigienizou.TipoHigienizacao === '', naoHigienizou);
  verificar('momento 1 é o primeiro da OMS',
    naoHigienizou.Momento === 'Antes do contato com paciente', naoHigienizou.Momento);

  /* Linha do Vigispec já na forma do banco não pode ser estragada ao reprocessar. */
  const jaCerta = imp.normalizarObservacaoHigiene({
    Data: '2026-07-31', Setor: 'UTI Neonatal / Pediátrica', Categoria: 'Técnico Enfermagem',
    Momento: 'Antes do contato com paciente', Acao: 'Higienizou', TipoHigienizacao: 'Álcool'
  });
  verificar('reprocessar linha correta não apaga o insumo',
    jaCerta.Acao === 'Higienizou' && jaCerta.TipoHigienizacao === 'Álcool', jaCerta);
  verificar('idempotente: normalizar duas vezes dá o mesmo',
    JSON.stringify(imp.normalizarObservacaoHigiene(doCelular)) === JSON.stringify(doCelular));

  verificar('momento por extenso do miniapp também casa',
    imp.momentoCanonico('Antes de tocar o paciente') === 'Antes do contato com paciente',
    imp.momentoCanonico('Antes de tocar o paciente'));
  verificar('momento desconhecido é preservado, não descartado',
    imp.momentoCanonico('Momento novo') === 'Momento novo');
  verificar('categoria desconhecida é preservada',
    imp.categoriaProfissional('Nutricionista') === 'Nutricionista');

  /* Importação do Vigispec continua produzindo a mesma forma. */
  const linhas = [
    ['Data', 'Setor', 'Turno', 'Profissional', 'Momento', 'Adesão'],
    ['2026-07-31', 'UTI', 'Dia', 'Técnico Enfermagem', 'Antes do contato com paciente', 'Álcool']
  ];
  const mapa = ['Data', 'Setor', 'Turno', 'Categoria', 'Momento', 'Adesao']
    .map((destino, coluna) => ({ coluna, cabecalho: linhas[0][coluna], destino }));
  const r = imp.normalizarLinhas(linhas, 0, mapa, 'higiene_maos', []);
  const gravada = imp.montarLinhaImportada(r.registros[0], 'higiene_maos', 'HIG-1', 't', '2026-08-31 12:00');
  verificar('o Vigispec continua entrando na mesma forma',
    gravada.Acao === 'Higienizou' && gravada.TipoHigienizacao === 'Álcool'
    && gravada.Momento === 'Antes do contato com paciente', gravada);
}

console.log('\n== 37. Catálogo da farmácia: apresentação → princípio ativo ==');
{
  const p = imp.principioAtivo;
  verificar('tira o sal e a apresentação', p('CLORIDRATO DE VANCOMICINA 500MG FA') === 'Vancomicina', p('CLORIDRATO DE VANCOMICINA 500MG FA'));
  verificar('tira o sal com "di"', p('DICLORIDRATO DE ETAMBUTOL 400MG COMP (MIN DA SAUDE)') === 'Etambutol', p('DICLORIDRATO DE ETAMBUTOL 400MG COMP (MIN DA SAUDE)'));
  verificar('caixa mista do sistema não atrapalha', p('CefTRIAXona 1G FA IV') === 'Ceftriaxona', p('CefTRIAXona 1G FA IV'));
  verificar('sal no meio do nome sai', p('CeFAZolina SODICA 1G FA') === 'Cefazolina', p('CeFAZolina SODICA 1G FA'));
  verificar('associação abreviada vira o nome usual',
    p('AMOXICILINA 500MG+CLAV POTASSIO 125MG COMP REV') === 'Amoxicilina-clavulanato',
    p('AMOXICILINA 500MG+CLAV POTASSIO 125MG COMP REV'));
  verificar('ceftazidima-avibactam não vira "pentaidratada"',
    p('CefTAZidima PENTAIDRATADA 2000MG + AVIBACTAM SODICO 500MG FA') === 'Ceftazidima-avibactam',
    p('CefTAZidima PENTAIDRATADA 2000MG + AVIBACTAM SODICO 500MG FA'));
  verificar('imipenem vem antes da cilastatina',
    p('CILASTATINA + IMIPENEM 500MG FA') === 'Imipenem-cilastatina', p('CILASTATINA + IMIPENEM 500MG FA'));
  verificar('colistimetato é colistina', p('COLISTIMETATO DE SODIO 1000000UI PO INJ/INAL FA') === 'Colistina');
  /* As duas penicilinas benzatínica e cristalina têm indicações diferentes: o recorte
     mecânico apagaria a palavra que as separa. */
  verificar('benzilpenicilina benzatina não vira cristalina',
    p('Benzilpenicilina BENZATINA 1.200.000UI FA') === 'Benzilpenicilina benzatina');
  verificar('benzilpenicilina cristalina não vira benzatina',
    p('Benzilpenicilina POTASSICA 5.000.000UI FA') === 'Benzilpenicilina cristalina');
  verificar('nome simples passa inteiro', p('MEROPENEM 1G FA') === 'Meropenem');
  verificar('descrição vazia não quebra', p('') === '' && p(null) === '');

  const gerar = imp.proximoID([], 'Codigo', 'ATM');
  const linha = imp.montarLinhaImportada(
    { Codigo: '2189', Apresentacao: 'CLORIDRATO DE VANCOMICINA 500MG FA', Classe: 'GLICOPEPTIDEOS', Grupo: 'ANTIBACTERIANO DE USO SISTEM', Padronizado: 'SIM' },
    'antimicrobianos', gerar(), 't', '2026-09-01 10:00');
  verificar('o código da farmácia manda, não o nosso ID', linha.Codigo === '2189', linha.Codigo);
  verificar('o princípio ativo entra como Nome', linha.Nome === 'Vancomicina', linha.Nome);
  verificar('a classe é preservada', linha.Classe === 'GLICOPEPTIDEOS');
}

console.log('\n== 38. Óbitos fecham as internações — e só elas ==');
{
  const internacoes = [
    { Atendimento: '800001', Prontuario: '900001', DataInternacao: '2026-06-01', DataAlta: '', Obito: 'N', Desfecho: '' },
    { Atendimento: '800002', Prontuario: '900002', DataInternacao: '2026-06-05', DataAlta: '2026-06-20', Obito: 'S', Desfecho: 'Óbito' },
    { Atendimento: '800003', Prontuario: '900003', DataInternacao: '2026-07-01', DataAlta: '2026-07-10', Obito: 'N', Desfecho: 'Alta' }
  ];
  const obitos = [
    { Atendimento: '800001', DataObito: '2026-06-12' },
    { Atendimento: '800002', DataObito: '2026-06-20' },
    { Atendimento: '700999', DataObito: '2025-03-01' }
  ];
  const r = imp.aplicarObitos(internacoes, obitos);
  verificar('fecha a internação aberta', r.atualizadas === 1, r);
  verificar('marca alta, óbito e desfecho',
    internacoes[0].DataAlta === '2026-06-12' && internacoes[0].Obito === 'S' && internacoes[0].Desfecho === 'Óbito',
    internacoes[0]);
  verificar('óbito já registrado não conta de novo', r.jaMarcadas === 1, r.jaMarcadas);
  verificar('óbito sem internação é contado à parte', r.semInternacao === 1, r.semInternacao);
  /* A internação que teve alta viva e não está na lista de óbitos não pode ser mexida. */
  verificar('quem teve alta viva continua com alta viva',
    internacoes[2].Obito === 'N' && internacoes[2].Desfecho === 'Alta', internacoes[2]);
  verificar('nenhuma internação é criada para o óbito órfão', internacoes.length === 3, internacoes.length);
  verificar('rodar duas vezes não muda nada',
    imp.aplicarObitos(internacoes, obitos).atualizadas === 0);
}

console.log('\n== 39. Correções da revisão geral ==');
{
  /* Data de nascimento como serial do Excel: 17500 ≈ 1947 — o piso antigo rejeitava. */
  verificar('serial de 1947 vira data', imp.normalizarData(17500) === '1947-11-29', imp.normalizarData(17500));
  verificar('número pequeno continua não sendo data', imp.normalizarData(77) === null);

  /* Resultado negativo por extenso: normalizarTexto tira espaços, a regex tem de casar. */
  const t = c => imp.preClassificarCultura(c);
  verificar('"Não houve crescimento" é negativa',
    t({ Material: 'Urocultura', Resultado: 'Não houve crescimento de germes', Microrganismo: '' }) === 'Negativa');
  verificar('"Sem crescimento" é negativa',
    t({ Material: 'Hemocultura', Resultado: 'Sem crescimento após 5 dias', Microrganismo: '' }) === 'Negativa');
  verificar('"Pesquisa de SGB" sem a palavra swab é colonização',
    t({ Material: 'Pesquisa de SGB', Resultado: 'Positiva', Microrganismo: 'Streptococcus agalactiae' }) === 'Colonização');

  /* Reimportar cultura cujo nome de germe foi reescrito no banco não pode duplicar. */
  const bruto = { Prontuario: '1', DataColeta: '2026-08-01', Material: 'Hemocultura',
    Microrganismo: 'Enterobactéria resistente aos carbapenêmicos', _antibiograma: [] };
  const gravada = imp.montarLinhaImportada({ ...bruto }, 'culturas', 'CUL-9', 't', '2026-08-01 10:00');
  verificar('nome foi reescrito ao gravar', gravada.Microrganismo === 'Enterobactéria (não identificada)');
  const dedup = imp.deduplicar([{ ...bruto }], [gravada], 'culturas');
  verificar('reimportação do germe reescrito é duplicada, não nova',
    dedup.novos.length === 0 && dedup.duplicados.length === 1, dedup.novos.length);
}

console.log('\n== 40. Alertas ignoram água/leite; investigação sem data não silencia para sempre ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const hoje = '2026-08-30';
  const culturas = [
    { ID_Cultura: 'C1', Prontuario: '1', Setor: 'Hemodiálise', DataColeta: '2026-08-25',
      Microrganismo: 'Pseudomonas aeruginosa', MecanismoResistencia: 'ERC', StatusRevisao: 'triagem', AvaliacaoCCIH: 'Água' },
    { ID_Cultura: 'C2', Prontuario: '2', Setor: 'UTI', DataColeta: '2026-08-25',
      Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'ERC', StatusRevisao: 'triagem', AvaliacaoCCIH: 'Colonização' }
  ];
  const mdr = alertas.detectarMultirresistentes(culturas, [], hoje);
  verificar('água não vira alerta MDR', !mdr.some(a => a.ID_Cultura === 'C1'), mdr.length);
  verificar('colonização por MDR continua alertando (precisa de precaução)',
    mdr.some(a => a.ID_Cultura === 'C2'));

  const surto = { Setor: 'UTI', Microrganismo: 'Klebsiella pneumoniae', Inicio: '2026-08-01', Fim: '2026-08-20' };
  const semDataAberta = { Setor: 'UTI', Microrganismo: 'Klebsiella pneumoniae', DataInicio: '', DataFim: '', DataEncerramento: '' };
  const semDataFechada = { Setor: 'UTI', Microrganismo: 'Klebsiella pneumoniae', DataInicio: '', DataFim: '', DataEncerramento: '2025-01-10' };
  verificar('investigação aberta sem datas ainda casa', alertas.mesmaSuspeita(surto, semDataAberta) === true);
  verificar('investigação encerrada sem datas não engole suspeita nova',
    alertas.mesmaSuspeita(surto, semDataFechada) === false);
}

console.log('\n== 41. Vigilância pós-alta ==');
{
  const cl = c => imp.classificarParaVigilancia(c);
  verificar('artroplastia entra marcada como implante',
    cl({ Procedimento: 'Artroplastia Total Primária Do Joelho' }).marcar === true
    && cl({ Procedimento: 'Artroplastia Total Primária Do Joelho' }).implante === true);
  verificar('marcapasso é implante', cl({ Procedimento: 'Implante De Marcapasso De Câmara Dupla' }).implante === true);
  verificar('cesariana entra marcada', cl({ Procedimento: 'Operação Cesariana Em Gestação De Alto Risco' }).marcar === true);
  verificar('cirurgia limpa entra marcada quando o campo vier',
    cl({ Procedimento: 'Herniorrafia', PotencialContaminacao: 'Limpa' }).marcar === true);
  verificar('contaminada fica desmarcada',
    cl({ Procedimento: 'Colectomia', PotencialContaminacao: 'Contaminada' }).marcar === false);
  verificar('não cirúrgico fica desmarcado com o motivo certo',
    cl({ Procedimento: 'Cateterismo Cardíaco' }).motivo === 'não cirúrgico');
  /* O mapa NHSN chama CVC/analgesia de "implante de cateter" — não pode virar prótese. */
  verificar('implante de cateter (NHSN) é não cirúrgico, não prótese',
    cl({ Procedimento: 'Bloqueios Prolongados De Sistema Nervoso Periférico',
      ProcedimentoNHSN: 'Implante de cateter para analgesia' }).motivo === 'não cirúrgico');
  verificar('cateter venoso central por punção é não cirúrgico',
    cl({ Procedimento: 'Implante De Cateter Venoso Central Por Punção, Para Npp' }).marcar === false
    && cl({ Procedimento: 'Implante De Cateter Venoso Central Por Punção, Para Npp' }).motivo === 'não cirúrgico');
  verificar('endoscopia solta é não cirúrgica',
    cl({ Procedimento: 'Endoscopia Digestiva Alta' }).motivo === 'não cirúrgico');
  verificar('"endoscópica" como adjetivo NÃO desclassifica a cirurgia',
    imp.categoriaDeVigilancia({ Procedimento: 'Ureterolitotripsia Endoscópica' }) !== 'nao_cirurgico');
  verificar('cirurgia POR VIDEOendoscopia continua cirurgia',
    imp.categoriaDeVigilancia({ Procedimento: 'Septoplastia Por Videoendoscopia' }) !== 'nao_cirurgico');
  verificar('"Implantação" de cateter também é não cirúrgico (grafia do CC)',
    cl({ Procedimento: 'Implantação De Cateter De Longa Permanência Semi Ou Totalmente Implantavel' }).motivo === 'não cirúrgico');
  verificar('sem classificação fica desmarcada (decisão manual)',
    cl({ Procedimento: 'Colecistectomia' }).marcar === false);

  /* A instituição escolhe as categorias vigiadas; sem lista, vale o trio de fábrica. */
  const comRotina = (c, cats) => imp.classificarParaVigilancia(c, cats);
  verificar('rotina com contaminadas pré-marca a contaminada',
    comRotina({ Procedimento: 'Colectomia', PotencialContaminacao: 'Contaminada' }, ['contaminada']).marcar === true);
  verificar('rotina personalizada pode EXCLUIR a prótese',
    comRotina({ Procedimento: 'Artroplastia Total' }, ['limpa']).marcar === false);
  verificar('rotina com sem_classificacao pega o campo vazio',
    comRotina({ Procedimento: 'Colecistectomia' }, ['sem_classificacao']).marcar === true);
  verificar('potencialmente contaminada é categoria própria, não vira contaminada',
    imp.categoriaDeVigilancia({ Procedimento: 'Histerectomia', PotencialContaminacao: 'Potencialmente contaminada' }) === 'potencialmente_contaminada');
  verificar('cesariana ganha do potencial de contaminação',
    imp.categoriaDeVigilancia({ Procedimento: 'Operação Cesariana', PotencialContaminacao: 'Potencialmente contaminada' }) === 'cesariana');
  verificar('não cirúrgico nunca entra, qualquer que seja a rotina',
    comRotina({ Procedimento: 'Cateterismo Cardíaco' }, ['sem_classificacao', 'contaminada']).marcar === false);
  verificar('lista vazia = padrão de fábrica (limpa entra)',
    comRotina({ Procedimento: 'Herniorrafia', PotencialContaminacao: 'Limpa' }, []).marcar === true);

  verificar('30 dias exatos entram na conta', imp.diasDesde('2026-08-02', '2026-09-01') === 30);
  verificar('data ilegível devolve null', imp.diasDesde('', '2026-09-01') === null);

  const t = imp.telefoneWhatsApp;
  verificar('celular com DDD ganha 55', t('(48) 99988-7766') === '5548999887766');
  verificar('fixo com DDD ganha 55', t('48 3333-2222') === '554833332222');
  verificar('número já com 55 passa direto', t('5548999887766') === '5548999887766');
  verificar('número curto é rejeitado', t('9998877') === '');
  verificar('vazio é rejeitado', t('') === '');

  const msg = imp.mensagemVigilancia('Olá {nome}, sua cirurgia {procedimento} foi em {data}.',
    { nome: 'Maria', procedimento: 'Artroplastia', data: '01/06/2026' });
  verificar('modelo preenche os campos', msg === 'Olá Maria, sua cirurgia Artroplastia foi em 01/06/2026.', msg);
  verificar('campo desconhecido fica visível no texto',
    imp.mensagemVigilancia('Oi {nomee}', { nome: 'Ana' }) === 'Oi {nomee}');
  const link = imp.linkWhatsApp('(48) 99988-7766', 'Olá!');
  verificar('link do WhatsApp com texto codificado',
    link === 'https://wa.me/5548999887766?text=Ol%C3%A1!', link);
  verificar('sem telefone não gera link', imp.linkWhatsApp('', 'Oi') === '');
}

console.log('\n== 42. Resumo para a visita técnica da UTI ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  verificar('CTI com nome longo é setor de UTI', alertas.ehSetorDeUTI('CTI - Dr. Joaquim David Ferreira Lima'));
  verificar('UTI Neonatal é setor de UTI', alertas.ehSetorDeUTI('UTI Neonatal / Pediátrica'));
  verificar('"instituto" não vira UTI por conter as letras', alertas.ehSetorDeUTI('Instituto de Cardiologia') === false);
  verificar('iniciais preservam só as letras', alertas.iniciaisDe('Joao Antonio Albino') === 'J.A.A.');

  const hoje = '2026-09-01';
  const bancos = {
    pacientes: { pacientes: [
      { Prontuario: '100', Nome: 'Maria Souza Lima' }, { Prontuario: '200', Nome: 'Jose Alves' }
    ] },
    culturas: { culturas: [
      { ID_Cultura: 'C1', Prontuario: '100', Setor: 'CTI - Dr. Joaquim', DataColeta: '2026-08-20',
        Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'ERC', StatusRevisao: 'avaliada', AvaliacaoCCIH: 'IRAS' },
      { ID_Cultura: 'C2', Prontuario: '200', Setor: 'CTI - Dr. Joaquim', DataColeta: '2026-06-01',
        Microrganismo: 'MRSA velho', MecanismoResistencia: 'MRSA', StatusRevisao: 'avaliada', AvaliacaoCCIH: 'IRAS' }
    ], sensibilidade: [] },
    isolamentos: { precaucoes: [
      { Prontuario: '100', Setor: 'CTI - Dr. Joaquim', Leito: '11', TipoPrecaucao: 'Contato',
        Motivo: 'ERC', Status: 'ativo', DataFim: '' },
      { Prontuario: '200', Setor: 'CTI - Dr. Joaquim', Leito: '12', TipoPrecaucao: 'Gotículas',
        Motivo: 'Influenza', Status: 'encerrado', DataFim: '2026-08-01' }
    ] },
    iras: { casos: [{ Prontuario: '100', Setor: 'CTI - Dr. Joaquim', DataInfeccao: '2026-08-15', Topografia: 'PAV' }] },
    sepse: { casos: [{ Prontuario: '100', Setor: 'CTI - Dr. Joaquim', DataProtocolo: '2026-08-10', AntibioticoAte1h: 'S' }] },
    /* Metade das observações vem do miniapp com rótulo de setor próprio ("Uti"):
       precisam casar com o CTI selecionado pela família adulto/neo, não pelo nome. */
    higiene_maos: { observacoes: Array.from({ length: 10 }, (_, i) => ({
      Setor: i % 2 ? 'Uti' : 'CTI - Dr. Joaquim', Data: '2026-08-1' + (i % 9),
      Momento: 'Antes do contato com paciente', Acao: i < 6 ? 'Higienizou' : 'Não higienizou' }))
      .concat([{ Setor: 'UTI Neonatal / Pediátrica', Data: '2026-08-15',
        Momento: 'Antes do contato com paciente', Acao: 'Não higienizou' }]) },
    uti: { visitas: [
      { Data: '2026-08-26', Prontuario: '100', Leito: '11', CVC: 'S', VM: '', SVD: 'S',
        CVC_Retirar: 'S', VM_Retirar: '', SVD_Retirar: '' },
      { Data: '2026-08-26', Prontuario: '200', Leito: '12', CVC: '', VM: 'S', SVD: 'S',
        CVC_Retirar: '', VM_Retirar: '', SVD_Retirar: '' }
    ] },
    dispositivos: { dispositivos: [
      { Prontuario: '100', Categoria: 'CVC', DataInstalacao: '2026-08-01', DataRetirada: '' }
    ] },
    surtos: { investigacoes: [] }
  };
  const r = alertas.resumoParaVisitaUTI(bancos, 'CTI - Dr. Joaquim', hoje);
  const titulos = r.blocos.map(b => b.titulo).join(' | ');
  verificar('MDR do mês entra; o de junho não',
    /Multirresistentes \(1/.test(titulos), titulos);
  verificar('paciente vira iniciais, sem nome inteiro',
    r.texto.includes('M.S.L.') && !r.texto.includes('Maria Souza'), r.texto.slice(0, 300));
  verificar('só o isolamento ATIVO aparece',
    /isolamento agora \(1\)/.test(titulos), titulos);
  verificar('IRAS do mês com topografia', r.texto.includes('1× PAV'));
  verificar('sepse com indicador de ATB 1h', r.texto.includes('antibiótico em até 1h: 1 de 1'));
  verificar('higiene do miniapp ("Uti") entra no CTI adulto e a neonatal fica fora',
    r.texto.includes('adesão: 60% (10 oportunidades)'), r.texto);
  verificar('utilização de dispositivos vem das avaliações das visitas',
    r.texto.includes('CVC: 1/2 (50%) · ventilação mecânica: 1/2 (50%) · sonda vesical: 2/2 (100%)'), r.texto);
  verificar('taxa declara que é fotografia dos dias de visita',
    r.texto.includes('fotografia de 2 avaliações em 1 dia(s) de visita'));
  verificar('retirada sugerida que segue em uso vira pendência',
    r.texto.includes('CVC — retirada sugerida em 2026-08-26, segue em uso'), r.texto);
  verificar('cabeçalho traz setor e data', r.texto.startsWith('*Resumo CCIH — CTI - Dr. Joaquim — 01/09/2026*'));

  const vazio = alertas.resumoParaVisitaUTI({ pacientes: { pacientes: [] } }, 'CTI X', hoje);
  verificar('sem ocorrências não quebra e diz isso', vazio.texto.includes('Sem ocorrências'));
}

console.log('\n== 43. Antibióticos: cursos, doses e alertas ==');
{
  /* O extrato renova a janela a cada 1-3 dias: as janelas contíguas são UM curso. */
  const prescricoes = [
    { ID_Prescricao: 'P1', Prontuario: '100', Antibiotico: 'Meropenem', Setor: 'CTI', Dose: '2 g 8/8h IV', DataInicio: '2026-08-20', DataFim: '2026-08-22' },
    { ID_Prescricao: 'P2', Prontuario: '100', Antibiotico: 'Meropenem', Setor: 'CTI', Dose: '2 g 8/8h IV', DataInicio: '2026-08-23', DataFim: '2026-08-25' },
    { ID_Prescricao: 'P3', Prontuario: '100', Antibiotico: 'Meropenem', Setor: 'CTI', Dose: '2 g 8/8h IV', DataInicio: '2026-08-26', DataFim: '2026-09-02' },
    /* buraco de 5 dias: outro curso */
    { ID_Prescricao: 'P4', Prontuario: '100', Antibiotico: 'Vancomicina', Setor: 'CTI', Dose: '2 g 6/6h IV', DataInicio: '2026-07-01', DataFim: '2026-07-05' },
    { ID_Prescricao: 'P5', Prontuario: '100', Antibiotico: 'Vancomicina', Setor: 'CTI', Dose: '2 g 6/6h IV', DataInicio: '2026-08-30', DataFim: '2026-09-02' },
    { ID_Prescricao: 'P6', Prontuario: '200', Antibiotico: 'Ceftriaxona', Setor: 'UTI Neonatal / Pediátrica', Dose: '80 mg 12/12h IV', DataInicio: '2026-09-01', DataFim: '2026-09-02' }
  ];
  const cursos = imp.cursosDeAntibiotico(prescricoes);
  verificar('janelas contíguas fundem num curso só',
    cursos.filter(c => c.Antibiotico === 'Meropenem').length === 1, cursos.length);
  const mero = cursos.find(c => c.Antibiotico === 'Meropenem');
  verificar('curso vai do primeiro início ao último fim (14 dias)',
    mero.inicio === '2026-08-20' && mero.fim === '2026-09-02' && mero.dias === 14, mero);
  verificar('buraco de dias separa cursos',
    cursos.filter(c => c.Antibiotico === 'Vancomicina').length === 2);

  const d = imp.analisarDose('74 mg 8/8h IV');
  verificar('dose em mg com intervalo vira mg/dia', d.mgDia === 222 && d.vezesDia === 3 && d.via === 'IV', d);
  verificar('dose em g converte', imp.analisarDose('2 g 6/6h IV').mgDia === 8000);
  verificar('frasco-ampola não inventa mg/dia', imp.analisarDose('1 fa 8/8h IV').mgDia === null);
  verificar('1x ao dia', imp.analisarDose('500 mg 1x ao dia VO').mgDia === 500);
  verificar('dose vazia não quebra', imp.analisarDose('') === null);

  verificar('prescrição com fim futuro está ativa',
    imp.prescricaoAtiva({ DataFim: '2026-09-05' }, '2026-09-01') === true);
  verificar('prescrição com fim passado não está ativa',
    imp.prescricaoAtiva({ DataFim: '2026-08-25' }, '2026-09-01') === false);
  verificar('sem fim é ativa', imp.prescricaoAtiva({ DataFim: '' }, '2026-09-01') === true);

  const bancos = {
    antibioticos: { prescricoes },
    culturas: {
      culturas: [{ ID_Cultura: 'C1', Prontuario: '100', DataColeta: '2026-08-28',
        Material: 'Hemocultura', Microrganismo: 'Klebsiella pneumoniae', StatusRevisao: 'avaliada' }],
      sensibilidade: [{ ID_Cultura: 'C1', Antibiotico: 'Meropenem', Resultado: 'R' }]
    }
  };
  const alertas = imp.alertasDeAntibioticos(bancos, '2026-09-01');
  verificar('germe resistente ao ATB em uso vira alerta',
    alertas.some(a => a.tipo === 'resistencia' && a.detalhe.includes('Klebsiella')), alertas.map(a => a.tipo));
  verificar('curso de 14 dias vira alerta de duração',
    alertas.some(a => a.tipo === 'duracao' && a.detalhe.includes('14 dias')));
  verificar('vanco 8 g/dia em adulto vira alerta de dose',
    alertas.some(a => a.tipo === 'dose' && a.detalhe.includes('8.0 g/dia')), alertas.map(a => a.detalhe));
  verificar('setor pediátrico fica fora do alerta de dose',
    !alertas.some(a => a.tipo === 'dose' && a.curso.Antibiotico === 'Ceftriaxona'));
  verificar('curso encerrado não gera alerta',
    !alertas.some(a => a.curso.Antibiotico === 'Vancomicina' && a.curso.fim === '2026-07-05'));
  verificar('resistência vem antes de duração', alertas[0].tipo === 'resistencia');
}

console.log('\n== 44. Rotina da instituição e integração visita→antibióticos ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const hoje = '2026-09-01';
  const culturas = [
    { ID_Cultura: 'C1', Prontuario: '1', Setor: 'UTI', DataColeta: '2026-08-25',
      Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'Resistente a carbapenêmicos', StatusRevisao: 'avaliada' },
    { ID_Cultura: 'C2', Prontuario: '2', Setor: 'UTI', DataColeta: '2026-08-25',
      Microrganismo: 'Staphylococcus aureus', MecanismoResistencia: 'MRSA', StatusRevisao: 'avaliada' }
  ];
  verificar('sem lista, monitora tudo',
    alertas.detectarMultirresistentes(culturas, [], hoje).length === 2);
  verificar('lista vazia explícita também monitora tudo',
    alertas.detectarMultirresistentes(culturas, [], hoje, 30, []).length === 2);
  const soCarba = alertas.detectarMultirresistentes(culturas, [], hoje, 30, ['Resistente a carbapenêmicos']);
  verificar('lista com carbapenêmicos filtra o MRSA',
    soCarba.length === 1 && soCarba[0].Mecanismo.includes('carbapenêmicos'), soCarba.map(a => a.Mecanismo));
  verificar('a comparação tolera grafia parcial ("carbapenemicos")',
    alertas.detectarMultirresistentes(culturas, [], hoje, 30, ['carbapenemicos']).length === 1);
  verificar('pendências de isolamento respeitam a mesma lista',
    alertas.pendenciasIsolamento(culturas, [], [], [], hoje, 30, ['MRSA']).length === 1);

  /* Elo visita→prescrição: janela que cobre a data ganha; sem cobertura, a mais recente. */
  const prescricoes = [
    { ID_Prescricao: 'P1', Prontuario: '100', Antibiotico: 'Meropenem', DataInicio: '2026-08-20', DataFim: '2026-08-22' },
    { ID_Prescricao: 'P2', Prontuario: '100', Antibiotico: 'Meropenem', DataInicio: '2026-08-25', DataFim: '2026-08-27' },
    { ID_Prescricao: 'P3', Prontuario: '100', Antibiotico: 'Vancomicina', DataInicio: '2026-08-25', DataFim: '2026-08-27' }
  ];
  verificar('avaliação liga à janela que cobre a data da visita',
    imp.vincularAvaliacaoAPrescricao({ Prontuario: '100', Antibiotico: 'Meropenem', Data: '2026-08-26' }, prescricoes) === 'P2');
  verificar('visita fora de qualquer janela liga à prescrição mais recente da droga',
    imp.vincularAvaliacaoAPrescricao({ Prontuario: '100', Antibiotico: 'Meropenem', Data: '2026-08-30' }, prescricoes) === 'P2');
  verificar('droga que o paciente não tem devolve vazio',
    imp.vincularAvaliacaoAPrescricao({ Prontuario: '100', Antibiotico: 'Cefepima', Data: '2026-08-26' }, prescricoes) === '');
  verificar('grafia com caixa diferente casa',
    imp.vincularAvaliacaoAPrescricao({ Prontuario: '100', Antibiotico: 'VANCOMICINA', Data: '2026-08-26' }, prescricoes) === 'P3');
}

console.log('\n== 45. Auditoria de vocabulário: pares quase iguais, sem falsos casamentos ==');
{
  /* Sufixo trocado a 1 letra: par, apontando para o termo oficial. */
  const s1 = imp.auditarVocabulario(['Linezolida', 'Linezolide'], ['Linezolida'], { Linezolide: 3 });
  verificar('Linezolide → Linezolida (oficial ganha mesmo com menos usos)',
    s1.length === 1 && s1[0].de === 'Linezolide' && s1[0].para === 'Linezolida', JSON.stringify(s1));
  verificar('par por distância pede confirmação humana', /confirme/.test(s1[0].regra));

  /* Drogas diferentes a 2 letras: NÃO pareiam (12 letras < mínimo de 14 para distância 2). */
  const s2 = imp.auditarVocabulario(['Eritromicina', 'Azitromicina'], [], {});
  verificar('Eritromicina ↔ Azitromicina não vira par', s2.length === 0, JSON.stringify(s2));

  /* Termo longo com 2 diferenças (prefixo "H " de outro sistema): par. */
  const s3 = imp.auditarVocabulario(
    ['Recuperação Pós Anestésica Obstétrica', 'H RECUPERACAO POS ANESTESICA OBSTETRICA'],
    ['Recuperação Pós Anestésica Obstétrica'], {});
  verificar('setor com prefixo de outro sistema vira par para o oficial',
    s3.length === 1 && s3[0].para === 'Recuperação Pós Anestésica Obstétrica', JSON.stringify(s3));

  /* Espaço no meio do termo composto: caixa/acentos normalizam igual — regra antiga cobre. */
  const s4 = imp.auditarVocabulario(['lavado broncoalveolar', 'lavado bronco alveolar'], [],
    { 'lavado broncoalveolar': 18, 'lavado bronco alveolar': 2 });
  verificar('grafia com espaço a mais aponta para a mais usada',
    s4.length >= 1 && s4.every(p => p.para === 'lavado broncoalveolar'), JSON.stringify(s4));

  /* Par já sugerido pela regra antiga não duplica na varredura por distância. */
  const s5 = imp.auditarVocabulario(['Escherichia Coli', 'Escherichia coli'], []);
  verificar('cada termo de origem aparece uma vez só',
    new Set(s5.map(p => p.de)).size === s5.length, JSON.stringify(s5));
}

console.log('\n== 46. Lista de notificação de isolamentos: só os nascidos no app, só os do dia ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const precaucoes = [
    { ID_Precaucao: 'PRC-000001', Prontuario: '100', DataInicio: '2026-09-02', TipoPrecaucao: 'Contato' },
    { ID_Precaucao: 'PRC-000002', Prontuario: '200', DataInicio: '2026-09-01', TipoPrecaucao: 'Contato' },
    /* Importada da lista do hospital no mesmo dia: já está no sistema de lá. */
    { ID_Precaucao: 'PRE-000034', Prontuario: '300', DataInicio: '2026-09-02', TipoPrecaucao: 'Aerossóis' }
  ];
  const lista = alertas.isolamentosParaNotificar(precaucoes, '2026-09-02');
  verificar('só o registro do app feito no dia entra',
    lista.length === 1 && lista[0].ID_Precaucao === 'PRC-000001', JSON.stringify(lista));
  verificar('sem precauções não quebra', alertas.isolamentosParaNotificar(null, '2026-09-02').length === 0);
}

console.log('\n== 47. Relatórios padrão: escopo, período, denominadores honestos ==');
{
  global.culturaDoPainel = imp.culturaDoPainel;
  global.cursosDeAntibiotico = imp.cursosDeAntibiotico;
  global.categoriaDeVigilancia = imp.categoriaDeVigilancia;
  global.inferirMecanismo = require(path.join(__dirname, '..', 'js', 'alertas.js')).inferirMecanismo;
  const rel = require(path.join(__dirname, '..', 'js', 'relatorios.js'));
  const bancos = {
    pacientes: { internacoes: [
      /* 31 dias inteiros dentro de agosto + uma internação que atravessa o início. */
      { DataInternacao: '2026-08-01', DataAlta: '2026-08-31' },
      { DataInternacao: '2026-07-20', DataAlta: '2026-08-05' }
    ] },
    iras: { casos: [
      { DataInfeccao: '2026-08-10', Setor: 'CTI', Topografia: 'PAV', Microrganismo: 'Klebsiella pneumoniae',
        DispositivoAssociado: 'VM', ConfirmadoPor: 'Maria', StatusInvestigacao: 'confirmado' },
      { DataInfeccao: '2026-08-20', Setor: 'Unidade 05', Topografia: 'ITU', Microrganismo: '',
        DispositivoAssociado: '', ConfirmadoPor: '', StatusInvestigacao: 'em investigação' },
      { DataInfeccao: '2026-07-10', Setor: 'CTI', Topografia: 'PAV' }
    ] },
    culturas: { culturas: [
      { ID_Cultura: 'C1', DataColeta: '2026-08-05', Setor: 'CTI', Material: 'Hemocultura',
        Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'ERC', StatusRevisao: 'avaliada', AvaliacaoCCIH: 'IRAS' },
      { ID_Cultura: 'C2', DataColeta: '2026-08-06', Setor: 'CTI', Material: 'Urocultura',
        Microrganismo: '', Resultado: 'Negativa', StatusRevisao: 'triagem', AvaliacaoCCIH: 'Negativa' },
      /* Sem mecanismo declarado — tem de ser inferido do antibiograma (meropenem R). */
      { ID_Cultura: 'C3', DataColeta: '2026-08-07', Setor: 'CTI', Material: 'Urocultura',
        Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: '', StatusRevisao: 'avaliada', AvaliacaoCCIH: 'IRAS' }
    ], sensibilidade: [
      { ID_Cultura: 'C3', Antibiotico: 'Meropenem', Resultado: 'R' }
    ] },
    higiene_maos: { observacoes: [
      { Data: '2026-08-02', Setor: 'CTI', Categoria: 'Enfermagem', Momento: 'Antes do contato com paciente', Acao: 'Higienizou' },
      { Data: '2026-08-02', Setor: 'CTI', Categoria: 'Médicos', Momento: 'Antes do contato com paciente', Acao: 'Não higienizou' },
      { Data: '2026-08-03', Setor: 'Unidade 05', Categoria: 'Enfermagem', Momento: 'Após contato com paciente', Acao: 'Higienizou' }
    ] },
    antibioticos: {
      prescricoes: [
        /* Duas janelas emendadas = UM curso de 12 dias (prolongado), 11 deles em agosto. */
        { ID_Prescricao: 'P1', Prontuario: '100', Antibiotico: 'Meropenem', Setor: 'CTI', DataInicio: '2026-07-31', DataFim: '2026-08-05' },
        { ID_Prescricao: 'P2', Prontuario: '100', Antibiotico: 'Meropenem', Setor: 'CTI', DataInicio: '2026-08-06', DataFim: '2026-08-11' },
        { ID_Prescricao: 'P3', Prontuario: '200', Antibiotico: 'Cefepima', Setor: 'Unidade 05', DataInicio: '2026-08-10', DataFim: '2026-08-12' }
      ],
      avaliacoes: [
        { Prontuario: '100', Antibiotico: 'Meropenem', Avaliacao: 'Correto', Recomendacao: 'Manter', DataDados: '2026-08-11' },
        { Prontuario: '200', Antibiotico: 'Cefepima', Avaliacao: 'Incorreto', Recomendacao: 'Descalonar', DataDados: '2026-08-12' }
      ] },
    isolamentos: {
      precaucoes: [
        { ID_Precaucao: 'PRC-000001', Setor: 'CTI', TipoPrecaucao: 'Contato', Motivo: 'ERC', DataInicio: '2026-08-08', DataFim: '' },
        { ID_Precaucao: 'PRE-000001', Setor: 'CTI', TipoPrecaucao: 'Aerossóis', Motivo: 'TB', DataInicio: '2026-07-01', DataFim: '2026-08-02' }
      ],
      decisoes: [
        { ID_Cultura: 'C1', Prontuario: '100', Decisao: 'isolado', CriadoEm: '2026-08-08 10:00' },
        { ID_Cultura: 'C2', Prontuario: '200', Decisao: 'não indicado', CriadoEm: '2026-08-09 10:00' }
      ] },
    sepse: { casos: [
      { DataProtocolo: '2026-08-15', Setor: 'CTI', SepseConfirmada: 'S', AntibioticoAte1h: 'S',
        HemoculturaAntesATB: 'S', BundleCompleto: 'N', MinutosAntibiotico: '45', FocoInfeccioso: 'Pulmonar', Desfecho: 'Alta' },
      { DataProtocolo: '2026-08-16', Setor: 'CTI', ExcluidoIndicadores: 'S' }
    ] },
    cirurgias: { cirurgias: [
      { DataCirurgia: '2026-08-03', ProcedimentoNHSN: 'Cesariana', StatusVigilancia: 'sem infecção', ISC: '' },
      { DataCirurgia: '2026-08-04', ProcedimentoNHSN: 'Prótese de quadril', StatusVigilancia: 'infecção confirmada', ISC: 'S', TipoISC: 'Superficial' },
      { DataCirurgia: '2026-08-05', ProcedimentoNHSN: 'Cesariana', StatusVigilancia: 'mensagem enviada', ISC: '' },
      /* Telefone errado no cadastro: baixa em categoria própria, fora do sucesso do contato. */
      { DataCirurgia: '2026-08-06', ProcedimentoNHSN: 'Cesariana', StatusVigilancia: 'encerrada — número incorreto', ISC: '' },
      /* Cateter mapeado por engano como Apendicectomia no NHSN: fora da conta inteira. */
      { DataCirurgia: '2026-08-06', Procedimento: 'Implantação De Cateter De Longa Permanência',
        ProcedimentoNHSN: 'Apendicectomia', StatusVigilancia: 'pendente', ISC: '' }
    ] }
  };

  const pd = rel.pacientesDia(bancos.pacientes.internacoes, '2026-08-01', '2026-08-31');
  verificar('pacientes-dia soma só a sobreposição com o período', pd === 31 + 5, String(pd));

  const iras = rel.relatorioIRAS(bancos, null, '2026-08-01', '2026-08-31');
  const itens = Object.fromEntries(iras.secoes[0].itens);
  verificar('IRAS: julho fica fora, agosto entra', itens['IRAS no período'] === 2);
  verificar('IRAS: dupla assinatura separa confirmadas', itens['Confirmadas (dupla assinatura)'] === 1);
  verificar('IRAS: densidade usa pacientes-dia', itens['Densidade por 1.000 pacientes-dia'] === (2 / 36 * 1000).toFixed(2));
  const irasCTI = rel.relatorioIRAS(bancos, ['CTI'], '2026-08-01', '2026-08-31');
  verificar('IRAS com escopo: filtra setor e NÃO mostra densidade',
    Object.fromEntries(irasCTI.secoes[0].itens)['IRAS no período'] === 1
    && Object.fromEntries(irasCTI.secoes[0].itens)['Densidade por 1.000 pacientes-dia'] === '—');
  verificar('IRAS com escopo: nota explica a falta do denominador',
    irasCTI.secoes.some(s => s.tipo === 'texto' && /setor de ENTRADA/.test(s.corpo)));

  const micro = rel.relatorioMicrobiologico(bancos, null, '2026-08-01', '2026-08-31');
  const mItens = Object.fromEntries(micro.secoes[0].itens);
  verificar('Micro: negativa em triagem fica fora do painel', mItens['Com microrganismo (painel)'] === '2 (67%)', JSON.stringify(mItens));
  verificar('Micro: mecanismo declarado E inferido do antibiograma contam como MDR',
    String(mItens['Com mecanismo de resistência']).startsWith('2 '), JSON.stringify(mItens));
  const tabelaMecanismos = micro.secoes.find(s => s.titulo === 'Multirresistentes por mecanismo');
  verificar('Micro: tabela de mecanismos usa o inferido',
    tabelaMecanismos.linhas.some(([mec]) => /carbapen/i.test(mec)), JSON.stringify(tabelaMecanismos.linhas));

  const hig = rel.relatorioHigiene(bancos, null, '2026-08-01', '2026-08-31');
  verificar('Higiene: adesão geral calculada', Object.fromEntries(hig.secoes[0].itens)['Adesão geral'] === '67%');
  const higCTI = rel.relatorioHigiene(bancos, ['CTI'], '2026-08-01', '2026-08-31');
  verificar('Higiene com escopo: só o CTI', Object.fromEntries(higCTI.secoes[0].itens)['Oportunidades observadas'] === 2);

  const atb = rel.relatorioAntibioticos(bancos, null, '2026-08-01', '2026-08-31');
  const aItens = Object.fromEntries(atb.secoes[0].itens);
  verificar('ATB: janelas emendadas viram um curso e o DOT respeita o período',
    aItens['Dias de terapia (DOT) no período'] === 11 + 3, JSON.stringify(aItens));
  verificar('ATB: curso de 12 dias conta como prolongado', String(aItens['Cursos prolongados (10+ dias)']).startsWith('1 '));
  verificar('ATB: avaliações do período com % de corretas', String(aItens['Avaliadas como "Correto"']).startsWith('1 (50%)'));

  const iso = rel.relatorioIsolamentos(bancos, null, '2026-08-01', '2026-08-31');
  const iItens = Object.fromEntries(iso.secoes[0].itens);
  verificar('Isolamentos: iniciados no período', iItens['Precauções iniciadas no período'] === 1);
  verificar('Isolamentos: ativos no fim ignoram os já encerrados', iItens['Ativas no fim do período'] === 1);
  verificar('Isolamentos: tempo coleta→isolamento vem da decisão ligada à cultura',
    String(iItens['Tempo coleta → isolamento (mediana)']).startsWith('3 dia'));

  const sep = rel.relatorioSepse(bancos, null, '2026-08-01', '2026-08-31');
  const sItens = Object.fromEntries(sep.secoes[0].itens);
  verificar('Sepse: excluído aparece na contagem mas não nas taxas',
    sItens['Protocolos abertos'] === 2 && sItens['Excluídos dos indicadores'] === 1
    && String(sItens['Antibiótico em até 1h']).includes('(100%)'));

  const pos = rel.relatorioPosAlta(bancos, null, '2026-08-01', '2026-08-31');
  const pItens = Object.fromEntries(pos.secoes[0].itens);
  verificar('Pós-alta: taxa de ISC só entre desfechos conhecidos',
    pItens['Taxa de ISC (entre desfechos conhecidos)'] === '50%', JSON.stringify(pItens));
  const desempenho = Object.fromEntries(pos.secoes.find(s => s.titulo === 'Desempenho da vigilância').itens);
  verificar('Pós-alta: sucesso do contato = respostas / buscas concluídas (número errado fora do denominador)',
    String(desempenho['Sucesso do contato']).startsWith('100% (2 de 2'), JSON.stringify(desempenho));
  verificar('Pós-alta: número incorreto é categoria própria e conta como vigiada',
    desempenho['Descartadas por número incorreto/inexistente'] === 1
    && desempenho['Entraram na vigilância'] === 4, JSON.stringify(desempenho));
  const porTipoCir = pos.secoes.find(s => s.titulo === 'Por tipo de cirurgia');
  const cesariana = porTipoCir.linhas.find(l => l[0] === 'Cesariana');
  const totalTipos = porTipoCir.linhas.find(l => l[0] === 'TOTAL');
  verificar('Pós-alta por tipo: cesariana 3 cirurgias, 3 vigiadas, 1 resposta, 0 ISC, taxa 0%',
    JSON.stringify(cesariana) === JSON.stringify(['Cesariana', 3, 3, 1, 1, 0, '0%']), JSON.stringify(cesariana));
  verificar('Pós-alta por tipo: linha TOTAL fecha a conta e a taxa geral',
    totalTipos[1] === 4 && totalTipos[6] === '50%', JSON.stringify(totalTipos));
  verificar('Pós-alta: cateter mapeado como Apendicectomia fica fora da conta, declarado',
    pItens['Cirurgias no período'] === 4
    && pItens['Procedimentos não cirúrgicos (fora da conta)'] === 1
    && !porTipoCir.linhas.some(l => l[0] === 'Apendicectomia'), JSON.stringify(pItens));

  const exec = rel.relatorioResumoExecutivo(bancos, null, '2026-08-01', '2026-08-31');
  verificar('Resumo executivo: uma seção por relatório', exec.secoes.length === 7);
  verificar('Resumo executivo: herda os números-chave',
    Object.fromEntries(exec.secoes[0].itens)['IRAS'] === 2);

  verificar('mês anterior fechado (meio do ano)',
    JSON.stringify(rel.mesAnteriorIntervalo('2026-09-03')) === '["2026-08-01","2026-08-31"]');
  verificar('mês anterior fechado (virada de ano)',
    JSON.stringify(rel.mesAnteriorIntervalo('2026-01-15')) === '["2025-12-01","2025-12-31"]');
}

console.log('\n== 48. Perfil microbiológico das IRAS: colunas, Gram, %R com cores ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  global.GENEROS_GRAM_NEGATIVOS = alertas.GENEROS_GRAM_NEGATIVOS;
  global.inferirMecanismo = alertas.inferirMecanismo;
  const rel = require(path.join(__dirname, '..', 'js', 'relatorios.js'));

  verificar('colunas semestrais de 2 anos', rel.colunasDoPerfil(2024, 2025, true).length === 4
    && rel.colunasDoPerfil(2024, 2025, true)[1].rotulo === '2024 2ºsem');
  verificar('colunas anuais', rel.colunasDoPerfil(2024, 2025, false).map(c => c.rotulo).join(',') === '2024,2025');

  verificar('Gram: Klebsiella é negativo, S. aureus positivo, Candida é fungo',
    rel.classificarGram('Klebsiella pneumoniae') === 'Gram-negativos'
    && rel.classificarGram('Staphylococcus aureus') === 'Gram-positivos'
    && rel.classificarGram('Candida albicans') === 'fungos');

  verificar('espécie: Klebsiella pneumoniae própria; K. oxytoca própria; gênero solto vira spp',
    rel.especieEnterobacteria('Klebsiella pneumoniae') === 'Klebsiella pneumoniae'
    && rel.especieEnterobacteria('Klebsiella oxytoca') === 'Klebsiella oxytoca'
    && rel.especieEnterobacteria('Klebsiella sp.') === 'Klebsiella spp');
  verificar('"Enterobactéria (não identificada)" NÃO vira Enterobacter spp',
    rel.especieEnterobacteria('Enterobactéria resistente aos carbapenêmicos') === 'Enterobactéria (não identificada)');
  verificar('Pseudomonas não é enterobactéria', rel.especieEnterobacteria('Pseudomonas aeruginosa') === null);

  verificar('cores: 19% verde, 20% laranja, 50% vermelho',
    rel.corDeResistencia(19) === 'verde' && rel.corDeResistencia(20) === 'laranja' && rel.corDeResistencia(50) === 'vermelho');

  const bancos = {
    pacientes: { internacoes: [
      { DataInternacao: '2025-03-01', DataAlta: '2025-03-10' },
      { DataInternacao: '2025-08-01', DataAlta: '2025-08-05' }
    ] },
    iras: { casos: [
      { DataInfeccao: '2025-02-01', Setor: 'CTI', Topografia: 'PAV', Microrganismo: 'Klebsiella pneumoniae' },
      { DataInfeccao: '2025-09-01', Setor: 'CC', Topografia: 'ISC', Microrganismo: '' }
    ] },
    culturas: { culturas: [
      { ID_Cultura: 'C1', DataColeta: '2025-02-01', Setor: 'CTI', Microrganismo: 'Klebsiella pneumoniae',
        MecanismoResistencia: '', AvaliacaoCCIH: 'IRAS' },
      { ID_Cultura: 'C2', DataColeta: '2025-09-05', Setor: 'CC', Microrganismo: 'Staphylococcus aureus',
        MecanismoResistencia: '', AvaliacaoCCIH: 'IRAS — ISC' },
      /* Colonização: fora das IRAS, mas dentro de "todos os isolados". */
      { ID_Cultura: 'C3', DataColeta: '2025-03-10', Setor: 'CTI', Microrganismo: 'Escherichia coli',
        MecanismoResistencia: '', AvaliacaoCCIH: 'Colonização' }
    ], sensibilidade: [
      { ID_Cultura: 'C1', Antibiotico: 'Meropenem', Resultado: 'R' },
      { ID_Cultura: 'C1', Antibiotico: 'Ceftriaxona', Resultado: 'R' },
      { ID_Cultura: 'C2', Antibiotico: 'Oxacilina', Resultado: 'R' },
      { ID_Cultura: 'C3', Antibiotico: 'Sulfametoxazol + Trimetoprima', Resultado: 'S' },
      { ID_Cultura: 'C3', Antibiotico: 'Meropenem', Resultado: 'S' }
    ] }
  };
  const p = rel.perfilMicrobiologico(bancos, 2025, 2025, true);
  verificar('título traz o período', p.titulo.includes('2025'));
  const panorama = p.secoes.find(s => s.titulo.startsWith('2.'));
  const linhaTotal = panorama.linhas.find(l => l[0] === 'TOTAL');
  verificar('panorama: 1 IRAS por semestre', linhaTotal[1] === 1 && linhaTotal[2] === 1 && linhaTotal[3] === 2,
    JSON.stringify(panorama.linhas));
  verificar('panorama: IRAS por 100 internações calculada',
    panorama.linhas.some(l => l[0] === 'IRAS por 100 internações' && l[3] === '100.00'), JSON.stringify(panorama.linhas));
  const positividade = p.secoes.find(s => s.titulo === 'Positividade microbiológica');
  verificar('positividade: 1 de 2 com agente', positividade.corpo.includes('1 de 2') && positividade.corpo.includes('50%'));
  const gram = p.secoes.find(s => s.titulo === 'Distribuição por Gram');
  verificar('Gram calculado só nas culturas de IRAS',
    gram.corpo.includes('1 Gram-negativos') && gram.corpo.includes('1 Gram-positivos'), gram.corpo);
  const mdr = p.secoes.find(s => s.titulo.startsWith('5.'));
  verificar('MDR: mecanismo inferido do antibiograma, critério do sufixo da classificação',
    mdr.linhas.length === 2 && mdr.linhas[0][4] === 'Resistente a carbapenêmicos'
    && mdr.linhas.some(l => l[2] === 'ISC') && mdr.linhas.some(l => l[2] === 'IRAS'), JSON.stringify(mdr.linhas));
  const tabIRAS = p.secoes.find(s => s.titulo.startsWith('6.'));
  const kp = tabIRAS.linhas.find(l => l[0] === 'Klebsiella pneumoniae');
  const colMero = tabIRAS.colunas.indexOf('Meropenem');
  verificar('%R nas IRAS: K. pneumoniae 100% meropenem, vermelho',
    kp[colMero].t === '100% (n=1)' && kp[colMero].cor === 'vermelho', JSON.stringify(kp));
  verificar('%R nas IRAS: E. coli (colonização) fica FORA da tabela de IRAS',
    !tabIRAS.linhas.some(l => l[0] === 'Escherichia coli'));
  const tabTodas = p.secoes.find(s => s.titulo.startsWith('7.'));
  const ecoli = tabTodas.linhas.find(l => l[0] === 'Escherichia coli');
  verificar('%R em todos os isolados: E. coli entra, 0% meropenem, verde, grafia com + casa',
    ecoli && ecoli[colMero].t === '0% (n=1)' && ecoli[colMero].cor === 'verde'
    && ecoli[tabTodas.colunas.indexOf('Sulfa/TMP')].t === '0% (n=1)', JSON.stringify(ecoli));
}

console.log('\n== 49. Óbito encerra a vigilância pós-alta sozinho ==');
{
  const bancoPacientes = {
    obitos: [
      { Prontuario: '100', DataObito: '2026-08-20' },
      { Prontuario: '100', DataObito: '2026-08-25' }, /* duplicado: vale a mais antiga */
      { Prontuario: '400', DataObito: '' }             /* óbito sem data */
    ],
    internacoes: [
      { Prontuario: '200', DataAlta: '2026-07-10', Desfecho: 'Óbito por causa clínica', Obito: '' },
      { Prontuario: '300', DataAlta: '2026-07-15', Desfecho: 'Alta melhorada', Obito: '' }
    ]
  };
  const indice = imp.indiceDeObitos(bancoPacientes);
  verificar('óbito duplicado guarda a data mais antiga', indice.get('100') === '2026-08-20');
  verificar('desfecho "Óbito" da internação também conta', indice.get('200') === '2026-07-10');
  verificar('alta melhorada não vira óbito', !indice.has('300'));

  const morreuDepois = { Prontuario: '100', DataCirurgia: '2026-08-01' };
  const morreuAntes = { Prontuario: '100', DataCirurgia: '2026-08-22' };
  const vivo = { Prontuario: '300', DataCirurgia: '2026-08-01' };
  const semData = { Prontuario: '400', DataCirurgia: '2026-08-01' };
  verificar('óbito depois da cirurgia encerra', imp.faleceuAposCirurgia(morreuDepois, indice) === true);
  verificar('óbito ANTES da cirurgia é inconsistência, não encerra',
    imp.faleceuAposCirurgia(morreuAntes, indice) === false);
  verificar('paciente vivo segue na fila', imp.faleceuAposCirurgia(vivo, indice) === false);
  verificar('óbito sem data encerra mesmo assim', imp.faleceuAposCirurgia(semData, indice) === true);

  /* Diário de observações: registros se acumulam, nada se sobrescreve. */
  let diario = imp.acrescentarObservacao('', 'Relato do paciente', 'Ferida seca, sem febre.', 'Enf. Maria', '2026-09-04 10:00');
  diario = imp.acrescentarObservacao(diario, 'Avaliação', 'Sem sinais de ISC.', 'Enf. Maria', '2026-09-04 10:01');
  diario = imp.acrescentarObservacao(diario, '', 'Paciente ligou de volta relatando hiperemia.', 'Rogério', '2026-09-06 08:30');
  verificar('cada registro entra datado e assinado, em linha própria',
    diario.split('\n').length === 3
    && diario.includes('[2026-09-04 10:00 — Enf. Maria] Relato do paciente: Ferida seca, sem febre.')
    && diario.endsWith('[2026-09-06 08:30 — Rogério] Paciente ligou de volta relatando hiperemia.'), diario);
  verificar('texto vazio não suja o diário',
    imp.acrescentarObservacao(diario, 'Avaliação', '   ', 'X', '2026-09-07') === diario);
  verificar('diário preserva texto antigo de campo livre',
    imp.acrescentarObservacao('nota antiga solta', '', 'nova', 'A', '2026-09-07 09:00')
      === 'nota antiga solta\n[2026-09-07 09:00 — A] nova');
}

console.log('\n== 50. "Não é paciente internado": descarte reversível do registro provisório ==');
{
  const fazerBancos = () => ({
    bp: { pacientes: [
      { Prontuario: '19900101-ABC', Nome: 'Ana Bela Costa', Descartado: '' },
      { Prontuario: '100', Nome: 'Outra Pessoa' }
    ] },
    bc: { culturas: [
      { ID_Cultura: 'C1', Prontuario: '19900101-ABC', StatusRevisao: 'pendente' },
      { ID_Cultura: 'C2', Prontuario: '19900101-ABC', StatusRevisao: 'descartada' },
      { ID_Cultura: 'C3', Prontuario: '100', StatusRevisao: 'pendente' }
    ] },
    bcir: { cirurgias: [
      { ID_Cirurgia: 'CIR-1', Prontuario: '19900101-ABC', StatusVigilancia: 'pendente', ObservacoesVigilancia: '' }
    ] }
  });

  const { bp, bc, bcir } = fazerBancos();
  const r = imp.descartarRegistroProvisorio(bp, bc, bcir, '19900101-ABC', 'Rogério', '2026-09-05 09:00');
  verificar('descarte marca o cadastro, assinado',
    bp.pacientes[0].Descartado === 'S' && bp.pacientes[0].DescartadoPor === 'Rogério');
  verificar('culturas do registro saem dos dados válidos (a já descartada não conta de novo)',
    r.culturas === 1 && bc.culturas[0].StatusRevisao === 'descartada');
  verificar('cultura de outro paciente não é tocada', bc.culturas[2].StatusRevisao === 'pendente');
  verificar('cirurgia do registro é descartada com nota no diário',
    r.cirurgias === 1 && bcir.cirurgias[0].StatusVigilancia === 'descartada'
    && bcir.cirurgias[0].ObservacoesVigilancia.includes('não é paciente internado'));
  verificar('descartado some das sugestões de unificação',
    imp.sugerirUnificacoes(bp.pacientes.concat([{ Prontuario: '200', Nome: 'Ana Bela Costa' }])).length === 0);
  verificar('prontuário verdadeiro não pode ser descartado',
    (() => { try { imp.descartarRegistroProvisorio(bp, bc, bcir, '100', 'X', 'Y'); return false; }
      catch (e) { return /provis/.test(e.message); } })());

  const volta = imp.reverterDescarteProvisorio(bp, bc, bcir, '19900101-ABC', 'Maria', '2026-09-05 10:00');
  verificar('reversão limpa a marca e devolve tudo como pendente',
    bp.pacientes[0].Descartado === '' && volta.culturas === 2
    && bc.culturas.every(c => c.Prontuario !== '19900101-ABC' || c.StatusRevisao === 'pendente')
    && bcir.cirurgias[0].StatusVigilancia === 'pendente');
}

console.log('\n== 51. Decisão ATB: protocolo empírico + dados locais ==');
{
  const alertas = require(path.join(__dirname, '..', 'js', 'alertas.js'));
  const rel = require(path.join(__dirname, '..', 'js', 'relatorios.js'));
  global.inferirMecanismo = alertas.inferirMecanismo;
  global.GENEROS_GRAM_NEGATIVOS = alertas.GENEROS_GRAM_NEGATIVOS;
  global.indiceSensibilidade = rel.indiceSensibilidade;
  global.mecanismoDaCultura = rel.mecanismoDaCultura;
  global.cursosDeAntibiotico = imp.cursosDeAntibiotico;
  const prot = require(path.join(__dirname, '..', 'js', 'protocolo-atb.js'));
  const sindrome = id => prot.PROTOCOLO_ATB.sindromes.find(s => s.id === id);

  /* Ramos do protocolo — fidelidade ao documento validado. */
  const cistiteTfgBaixa = sindrome('urinario').decidir({ apresentacao: 'cistite', tfgBaixa: true });
  verificar('cistite com TFG<30: sem nitrofurantoína, fosfomicina em 1ª',
    !cistiteTfgBaixa.esquemas.some(e => e.drogas.includes('nitrofurantoina'))
    && cistiteTfgBaixa.esquemas[0].drogas.includes('fosfomicina'), JSON.stringify(cistiteTfgBaixa.esquemas));
  const cistiteHomem = sindrome('urinario').decidir({ sexo: 'homem', apresentacao: 'cistite' });
  verificar('cistite em homem segue o caminho da ITU complicada: cipro/levo, urocultura antes, sem nitrofurantoína',
    cistiteHomem.esquemas[0].drogas.includes('ciprofloxacino') && cistiteHomem.exames.some(x => /urocultura/i.test(x))
    && !cistiteHomem.esquemas.some(e => e.drogas.includes('nitrofurantoina')) && cistiteHomem.avisos.some(a => /ITU em homem/.test(a)),
    JSON.stringify(cistiteHomem));
  const pieloMulher = sindrome('urinario').decidir({ sexo: 'mulher', apresentacao: 'pielonefrite' });
  verificar('pielonefrite em mulher estável: cipro VO, sem aviso de ITU em homem',
    pieloMulher.esquemas[0].drogas.includes('ciprofloxacino') && pieloMulher.avisos.length === 0);
  const cistiteMulher = sindrome('urinario').decidir({ sexo: 'mulher', apresentacao: 'cistite' });
  verificar('cistite em mulher continua simples: nitrofurantoína e sem exames',
    cistiteMulher.esquemas[0].drogas.includes('nitrofurantoina') && /diagnóstico clínico/.test(cistiteMulher.exames[0]));
  const esblTfg = sindrome('urinario').decidir({ apresentacao: 'pielonefrite', riscoEsbl: true, tfgBaixa: true });
  verificar('pielonefrite ESBL com TFG<30: ertapenem, sem amicacina (adendo CCIH 05/09/2026)',
    esblTfg.esquemas.length === 1 && esblTfg.esquemas[0].drogas.join() === 'ertapenem'
    && esblTfg.avisos.some(a => /amicacina evitada/.test(a)), JSON.stringify(esblTfg));
  const alergiaTfg = sindrome('urinario').decidir({ apresentacao: 'pielonefrite', alergiaBL: true, tfgBaixa: true });
  verificar('pielonefrite alérgico com TFG<30: só levofloxacino ajustado, amicacina fora',
    alergiaTfg.esquemas.length === 1 && alergiaTfg.esquemas[0].drogas.join() === 'levofloxacino'
    && /48h/.test(alergiaTfg.esquemas[0].posologia));
  const estavelTfg = sindrome('urinario').decidir({ apresentacao: 'pielonefrite', tfgBaixa: true });
  verificar('pielonefrite estável com TFG<30: cipro 24/24h',
    /24\/24h/.test(estavelTfg.esquemas[0].posologia) && estavelTfg.esquemas[0].drogas.join() === 'ciprofloxacino');
  const pieloEsbl = sindrome('urinario').decidir({ apresentacao: 'pielonefrite', riscoEsbl: true });
  verificar('pielonefrite com risco ESBL vai de amicacina',
    pieloEsbl.esquemas.length === 1 && pieloEsbl.esquemas[0].drogas.includes('amicacina'));
  verificar('pielonefrite pede urocultura antes da primeira dose',
    pieloEsbl.exames.some(x => /urocultura/i.test(x)));
  const pacUtiMrsa = sindrome('respiratorio').decidir({ gravidade: 'internacao', riscoMRSA: true });
  verificar('PAC internada com risco MRSA: ceftriaxona+azitro E vancomicina associada',
    pacUtiMrsa.esquemas.some(e => e.drogas.includes('ceftriaxona') && e.drogas.includes('azitromicina'))
    && pacUtiMrsa.esquemas.some(e => e.drogas.includes('vancomicina')), JSON.stringify(pacUtiMrsa.esquemas));
  const aspSem = sindrome('respiratorio').decidir({ gravidade: 'internacao', aspirativa: true });
  const aspCom = sindrome('respiratorio').decidir({ gravidade: 'internacao', aspirativa: true, abscesso: true });
  verificar('aspirativa sem abscesso: ceftriaxona sozinha (adendo CCIH 05/09/2026)',
    aspSem.esquemas.length === 1 && aspSem.esquemas[0].drogas.join() === 'ceftriaxona', JSON.stringify(aspSem.esquemas));
  verificar('aspirativa com abscesso: ampicilina-sulbactam',
    aspCom.esquemas.length === 1 && aspCom.esquemas[0].drogas.join() === 'ampicilinasulbactam');
  const renalSepse = prot.ajusteRenalDosEsquemas(sindrome('sepse_fi').decidir({ riscoMDR: true }).esquemas);
  verificar('ajuste renal: sepse MDR traz pip-tazo, vancomicina, cefepima e a teicoplanina de transição, uma vez cada',
    renalSepse.map(r => r.rotulo).sort().join('|') === 'Cefepima|Piperacilina-tazobactam|Teicoplanina|Vancomicina', JSON.stringify(renalSepse.map(r => r.rotulo)));
  verificar('ajuste renal: ceftriaxona sozinha não gera tabela',
    prot.ajusteRenalDosEsquemas(sindrome('sepse_fi').decidir({}).esquemas).length === 0);
  verificar('toda linha da tabela renal tem rótulo e ≥2 faixas [tfg, dose]',
    Object.values(prot.AJUSTE_RENAL).every(r => r.rotulo && r.faixas.length >= 2 && r.faixas.every(f => f.length === 2 && f[0] && f[1])));
  verificar('orientação renal diz que a primeira dose é plena', /[Pp]rimeira dose sempre plena/.test(prot.ORIENTACAO_RENAL));
  verificar('vanco e amicacina: nível sérico só "quando disponível"; tabela cobre diálise sem depender de dosagem',
    /QUANDO DISPONÍVEL/.test(prot.ORIENTACAO_RENAL)
    && ['vancomicina', 'amicacina'].every(d => prot.AJUSTE_RENAL[d].faixas.every(f => !/nível/.test(f[1]))));
  verificar('risco de MRSA tem a mesma definição base em PAC, pele e pé diabético, com reforço do sítio',
    ['respiratorio', 'pele', 'pe_diabetico'].every(id => {
      const p = sindrome(id).perguntas.find(q => q.rotulo === 'Risco de MRSA');
      return p && p.ajuda.some(a => /MRSA prévio/.test(a)) && p.ajuda.some(a => /neste sítio/.test(a));
    }));
  const pd = sindrome('pe_diabetico');
  verificar('pé diabético leve: cefalexina VO; com risco MRSA: SMX-TMP',
    pd.decidir({ gravidade: 'leve' }).esquemas[0].drogas.join() === 'cefalexina'
    && pd.decidir({ gravidade: 'leve', riscoMRSA: true }).esquemas[0].drogas.join() === 'sulfametoxazoltrimetoprima');
  const pdMod = pd.decidir({ gravidade: 'moderada', riscoMRSA: true });
  verificar('pé diabético moderado com MRSA: ceftriaxona + metronidazol e vancomicina associada',
    pdMod.esquemas.some(e => e.drogas.join() === 'ceftriaxona,metronidazol') && pdMod.esquemas.some(e => e.drogas.join() === 'vancomicina'));
  const pdGrave = pd.decidir({ gravidade: 'grave', osteomielite: true });
  verificar('pé diabético grave: pip-tazo + vanco; osteomielite gera aviso de duração',
    pdGrave.esquemas[0].drogas.join() === 'piperacilinatazobactam,vancomicina' && pdGrave.avisos.some(a => /6 semanas/.test(a)));
  verificar('pé diabético grave alérgico: vanco + cipro + metronidazol',
    pd.decidir({ gravidade: 'grave', alergiaBL: true }).esquemas[0].drogas.join() === 'vancomicina,ciprofloxacino,metronidazol');
  verificar('pé diabético pede cultura profunda, não swab',
    pd.decidir({}).exames.some(x => /swab superficial/i.test(x)));
  const osteoPos = sindrome('osteoarticular').decidir({ posTrauma: true });
  verificar('teicoplanina aparece como transição em esquema com vancomicina fora do SNC',
    osteoPos.esquemas.some(e => e.drogas.includes('vancomicina')) && osteoPos.esquemas[osteoPos.esquemas.length - 1].drogas.join() === 'teicoplanina');
  verificar('SNC nunca oferece teicoplanina',
    !sindrome('snc').decidir({ posNeuro: true }).esquemas.some(e => e.drogas.includes('teicoplanina')));
  verificar('sem vancomicina no esquema, sem teicoplanina',
    !sindrome('pele').decidir({ grave: true }).esquemas.some(e => e.drogas.includes('teicoplanina')));
  verificar('teicoplanina tem tabela renal', prot.AJUSTE_RENAL.teicoplanina.faixas.length === 3);
  verificar('todo adendo tem data e texto',
    prot.PROTOCOLO_ATB.adendos.every(a => /^\d{4}-\d{2}-\d{2}$/.test(a.data) && a.texto.length > 20));
  const meningeIdoso = sindrome('snc').decidir({ listeria: true });
  verificar('meningite >50 anos associa ampicilina (Listeria) e mantém dexametasona',
    meningeIdoso.esquemas.some(e => e.drogas.includes('ampicilina'))
    && meningeIdoso.esquemas.some(e => /dexametasona/i.test(e.posologia)));
  const sepseMdr = sindrome('sepse_fi').decidir({ riscoMDR: true });
  verificar('sepse FI com risco MDR: pip-tazo+vanco ou cefepima+vanco (+ linha de transição para teicoplanina)',
    sepseMdr.esquemas.length === 3 && sepseMdr.esquemas.slice(0, 2).every(e => e.drogas.includes('vancomicina'))
    && sepseMdr.esquemas[2].drogas.join() === 'teicoplanina', JSON.stringify(sepseMdr.esquemas.map(e => e.rotulo)));
  verificar('todas as síndromes decidem sem resposta nenhuma (defaults seguros)',
    prot.PROTOCOLO_ATB.sindromes.every(s => {
      const d = s.decidir({});
      return d.esquemas.length >= 1 && d.exames.length >= 1;
    }));

  verificar('sinônimos de grafia: ceftriaxone→ceftriaxona, cefepime→cefepima',
    prot.drogaCanonicaATB('Ceftriaxone') === 'ceftriaxona' && prot.drogaCanonicaATB('CEFEPIME') === 'cefepima');

  /* Contexto local do paciente. */
  const bancos = {
    culturas: { culturas: [
      { ID_Cultura: 'C1', Prontuario: '100', DataColeta: '2026-06-01', Material: 'Urocultura',
        Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: 'ERC', AvaliacaoCCIH: 'Colonização' },
      { ID_Cultura: 'C2', Prontuario: '100', DataColeta: '2024-01-01', Material: 'Hemocultura',
        Microrganismo: 'Escherichia coli', MecanismoResistencia: 'ESBL', AvaliacaoCCIH: 'IRAS' }
    ], sensibilidade: [] },
    antibioticos: { prescricoes: [
      { ID_Prescricao: 'P1', Prontuario: '100', Antibiotico: 'Meropenem', DataInicio: '2026-08-20', DataFim: '2026-08-25' }
    ] },
    pacientes: { internacoes: [
      { Prontuario: '100', DataInternacao: '2026-08-18', DataAlta: '2026-08-26' }
    ] }
  };
  const ctx = prot.contextoLocalDoPaciente(bancos, '100', '2026-09-05');
  verificar('contexto: MDR de 12 meses entra, o de 2024 fica fora',
    ctx.mdr.length === 1 && ctx.mdr[0].mecanismo === 'ERC', JSON.stringify(ctx.mdr));
  verificar('contexto: ATB e internação nos últimos 90 dias detectados',
    ctx.atb90.includes('Meropenem') && ctx.internacao90 === true && ctx.riscoPresumido === true);
  verificar('contexto: alerta cita o germe, o mecanismo e a data',
    ctx.alertas.some(a => a.includes('Klebsiella pneumoniae') && a.includes('ERC') && a.includes('2026-06-01')));
  verificar('sem prontuário devolve null', prot.contextoLocalDoPaciente(bancos, '', '2026-09-05') === null);

  /* Antibiograma local + aviso cruzado. */
  const culturasEcoli = [];
  const sensEcoli = [];
  for (let i = 0; i < 25; i++) {
    culturasEcoli.push({ ID_Cultura: 'E' + i, Prontuario: String(i), DataColeta: '2026-05-01',
      Microrganismo: 'Escherichia coli', AvaliacaoCCIH: 'IRAS' });
    sensEcoli.push({ ID_Cultura: 'E' + i, Antibiotico: i % 2 ? 'Ciprofloxacino' : 'Ciprofloxacina', Resultado: i < 10 ? 'R' : 'S' });
    sensEcoli.push({ ID_Cultura: 'E' + i, Antibiotico: 'Ceftriaxone', Resultado: 'S' });
  }
  const bancosAB = { culturas: { culturas: culturasEcoli, sensibilidade: sensEcoli } };
  const ab = prot.antibiogramaLocalPorGermes(bancosAB, ['Escherichia coli'], '2026-09-05', 24);
  const cipro = ab[0].linhas.find(l => l.droga === 'ciprofloxacino');
  verificar('antibiograma local: grafias Ciprofloxacino/Ciprofloxacina somam na mesma linha',
    ab[0].culturas === 25 && cipro.testados === 25 && cipro.pctR === 40, JSON.stringify(ab[0].linhas));
  const avisosAB = prot.avisosDeResistenciaLocal(
    [{ rotulo: 'x', posologia: 'x', drogas: ['ciprofloxacino'] }], ab);
  verificar('40% de resistência local com n=25 vira aviso com números',
    avisosAB.length === 1 && avisosAB[0].includes('40%') && avisosAB[0].includes('n=25'), JSON.stringify(avisosAB));
  verificar('droga sem resistência relevante não gera aviso',
    prot.avisosDeResistenciaLocal([{ drogas: ['ceftriaxona'] }], ab).length === 0);

  /* Recorte fechado para o miniapp: o que está fora da janela não conta. */
  const fora = { ID_Cultura: 'FORA', Prontuario: '999', DataColeta: '2024-01-15',
    Microrganismo: 'Escherichia coli', AvaliacaoCCIH: 'IRAS' };
  const consolidado = prot.antibiogramaConsolidado(
    { culturas: { culturas: [...culturasEcoli, fora],
      sensibilidade: [...sensEcoli, { ID_Cultura: 'FORA', Antibiotico: 'Ciprofloxacino', Resultado: 'R' }] } },
    ['Escherichia coli'], '2024-06-01', '2026-06-30');
  const ciproCons = consolidado.germes[0].linhas.find(l => l.droga === 'ciprofloxacino');
  verificar('consolidado: cultura fora da janela fica de fora; n e %R iguais aos de dentro',
    consolidado.germes[0].culturas === 25 && ciproCons.testados === 25 && ciproCons.pctR === 40
    && consolidado.periodo.de === '2024-06-01', JSON.stringify(consolidado));
  verificar('aviso com período do recorte no texto',
    prot.avisosDeResistenciaLocal([{ drogas: ['ciprofloxacino'] }], consolidado.germes, 'entre jun/2024 e jun/2026')[0]
      .includes('testados entre jun/2024 e jun/2026'));
}

console.log(`\nResultado: ${passaram} passaram, ${falharam} falharam.`);
process.exit(falharam ? 1 : 0);
