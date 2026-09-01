/* Gera relatórios de amostra realistas em amostras/ para testar o importador. */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'lib', 'xlsx.full.min.js'));

const pastaAmostras = path.join(__dirname, '..', 'amostras');
fs.mkdirSync(pastaAmostras, { recursive: true });

function salvar(wb, nome, tipo) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: tipo });
  fs.writeFileSync(path.join(pastaAmostras, nome), buf);
  console.log('gerado:', nome);
}

/* 1. Culturas em xlsx: título antes do cabeçalho, antibiograma largo, dados sujos */
{
  const aoa = [
    ['HOSPITAL SÃO LUCAS — LABORATÓRIO DE MICROBIOLOGIA'],
    ['Período: 01/08/2026 a 13/08/2026'],
    [],
    ['Prontuário', 'Nome do Paciente', 'Setor', 'Data Coleta', 'Data Liberação', 'Material', 'Microorganismo', 'AMICACINA', 'GENTAMICINA', 'CIPROFLOXACINO', 'MEROPENEM', 'VANCOMICINA', 'OXACILINA'],
    ['0012345', 'MARIA DA SILVA', 'UTI ADULTO', '05/08/2026', '08/08/2026', 'Hemocultura', 'KLEB PNEUMONIAE', 'Sensível', 'R', 'R', 'R', '', ''],
    ['0012345', 'MARIA DA SILVA', 'UTI ADULTO', '05/08/2026', '08/08/2026', 'Hemocultura', 'Candida albicans', '', '', '', '', '', ''],
    ['7890', 'JOÃO PEREIRA', 'CLÍNICA MÉDICA', '06/08/2026', '09/08/2026', 'Urocultura', 'Escherichia coli', 'S', 'S', 'I', 'S', '', ''],
    ['4567', 'ANA SOUZA', 'UTI ADULTO', '07/08/2026', '10/08/2026', 'Secreção traqueal', 'Pseudomonas aeruginosa', 'R', 'I', 'S', 'S', '', ''],
    ['', 'SEM PRONTUÁRIO', 'UTI ADULTO', '08/08/2026', '', 'Hemocultura', 'Staphylococcus aureus', '', '', '', '', 'S', 'R'],
    ['9999', 'CARLOS LIMA', 'PS', '32/13/2026', '', 'Urocultura', 'Proteus mirabilis', 'S', '', '', '', '', ''],
    ['0012345', 'MARIA DA SILVA', 'UTI ADULTO', '05/08/2026', '08/08/2026', 'Hemocultura', 'KLEB PNEUMONIAE', 'Sensível', 'R', 'R', 'R', '', '']
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Relatorio');
  salvar(wb, 'culturas_lab.xlsx', 'xlsx');
}

/* 2. Culturas em csv com ; e codificação Windows-1252 (acentos) */
{
  const linhas = [
    'Prontuário;Nome;Setor;Data Coleta;Material;Microorganismo;GENTAMICINA;MEROPENEM',
    '5555;JOSÉ ARAÚJO;UTI ADULTO;10/08/2026;Secreção traqueal;Acinetobacter baumannii;R;R',
    '6666;CONCEIÇÃO ASSUNÇÃO;CLÍNICA CIRÚRGICA;11/08/2026;Urocultura;Escherichia coli;S;S'
  ].join('\r\n');
  fs.writeFileSync(path.join(pastaAmostras, 'culturas_lab.csv'), Buffer.from(linhas, 'latin1'));
  console.log('gerado: culturas_lab.csv (windows-1252)');
}

/* 3. Prescrições em xls antigo (BIFF8), com uma data em número serial do Excel */
{
  const aoa = [
    ['Prontuário', 'Paciente', 'Medicamento', 'Dose', 'Via', 'Posologia', 'Data Início', 'Data Fim', 'Setor'],
    ['0012345', 'MARIA DA SILVA', 'Meropenem', '1 g', 'EV', '8/8h', '05/08/2026', '', 'UTI ADULTO'],
    ['7890', 'JOÃO PEREIRA', 'CEFTRIAXONA', '2 g', 'EV', '1x/dia', '06/08/2026', 46252, 'CLÍNICA MÉDICA'],
    ['4567', 'ANA SOUZA', 'Polimixina B', '750.000 UI', 'EV', '12/12h', '07/08/2026', '', 'UTI ADULTO']
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Prescricoes');
  salvar(wb, 'prescricoes.xls', 'xls');
}

/* 4. Cirurgias em xlsx: ASA romano, contaminação com variantes, horas cruzando a meia-noite */
{
  const aoa = [
    ['Prontuário', 'Paciente', 'Telefone', 'Data Cirurgia', 'Procedimento', 'Cirurgião', 'Potencial de Contaminação', 'ASA', 'Hora Início', 'Hora Fim', 'Desfecho'],
    ['0012345', 'MARIA DA SILVA', '(55) 99999-1111', '10/08/2026', 'CESARIANA', 'DR. AUGUSTO', 'Potencialmente contaminada', 'ASA II', '08:10', '09:05', 'ALTA MELHORADA'],
    ['7777', 'RITA GOMES', '51 3322-4455', '11/08/2026', 'COLECISTECTOMIA VIDEOLAPAROSCÓPICA', 'DRA. BEATRIZ', 'Limpa-contaminada', 'III', '23:30', '01:10', 'ÓBITO'],
    ['8888', 'BENTO ROCHA', '', '12/08/2026', 'HERNIOPLASTIA INGUINAL', 'DR. CARLOS', 'Limpa', 'I', '10:00', '11:20', '']
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Cirurgias');
  salvar(wb, 'cirurgias.xlsx', 'xlsx');
}

/* 5. Casos de IRAS exportados de outro sistema (csv UTF-8) */
{
  const linhas = [
    'Prontuário;Paciente;Data da Infecção;Topografia;Setor;Dispositivo;Microrganismo;Critério',
    '0012345;MARIA DA SILVA;07/08/2026;IPCS laboratorial;UTI ADULTO;cateter venoso central;Klebsiella pneumoniae;IPCS-CL1',
    '2222;OTO MAIA;05/08/2026;PAV;UTI ADULTO;ventilação mecânica;Pseudomonas aeruginosa;PNU2'
  ].join('\r\n');
  fs.writeFileSync(path.join(pastaAmostras, 'iras_migracao.csv'), '﻿' + linhas, 'utf-8');
  console.log('gerado: iras_migracao.csv (utf-8)');
}

/* 6. Culturas em dbf (nomes de campo até 10 caracteres, como nos sistemas legados) */
{
  const objetos = [
    { PRONTUARIO: '3333', PACIENTE: 'PEDRO ALVES', DATACOLETA: '09/08/2026', MATERIAL: 'Hemocultura', GERME: 'Enterococcus faecalis', RESULTADO: 'positiva' },
    { PRONTUARIO: '4444', PACIENTE: 'LUCIA NUNES', DATACOLETA: '12/08/2026', MATERIAL: 'Urocultura', GERME: 'Klebsiella pneumoniae', RESULTADO: 'positiva' }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(objetos), 'CULTURAS');
  salvar(wb, 'culturas.dbf', 'dbf');
}
