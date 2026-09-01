/* Gera amostras/avaliacao-teste.html (senha: ccih123) e confere a criptografia ida-e-volta. */
const fs = require('fs');
const path = require('path');

const leitura = require(path.join(__dirname, '..', 'js', 'leitura.js'));
global.normalizarTexto = leitura.normalizarTexto;
const imp = require(path.join(__dirname, '..', 'js', 'importacao.js'));
global.normalizarProntuario = imp.normalizarProntuario;
global.inferirMecanismo = require(path.join(__dirname, '..', 'js', 'alertas.js')).inferirMecanismo;
const av = require(path.join(__dirname, '..', 'js', 'avaliacao.js'));

const bancos = {
  prescricoes: [
    { ID_Prescricao: 'PRE-000001', Prontuario: '0012345', Antibiotico: 'Meropenem', Dose: '1 g', Via: 'EV', Frequencia: '8/8h', DataInicio: '2026-08-10', DataFim: '', Setor: 'UTI ADULTO', Indicacao: 'PAV', UltimaEvolucao: 'Paciente febril há 48h, secreção traqueal purulenta, PCR em ascensão. Em VM desde 08/08.' },
    { ID_Prescricao: 'PRE-000002', Prontuario: '0012345', Antibiotico: 'Vancomicina', DataInicio: '2026-08-01', DataFim: '2026-08-08', Setor: 'UTI ADULTO' },
    { ID_Prescricao: 'PRE-000003', Prontuario: '777', Antibiotico: 'Ceftriaxona', Dose: '2 g', Via: 'EV', Frequencia: '1x/dia', DataInicio: '2026-08-16', DataFim: '', Setor: 'CLÍNICA MÉDICA', Indicacao: 'ITU', UltimaEvolucao: 'Afebril há 24h, diurese clara.' }
  ],
  avaliacoes: [],
  culturas: [
    { ID_Cultura: 'CUL-1', Prontuario: '0012345', DataColeta: '2026-08-12', Material: 'Secreção traqueal', Microrganismo: 'Klebsiella pneumoniae', MecanismoResistencia: '', StatusRevisao: 'pendente' },
    { ID_Cultura: 'CUL-2', Prontuario: '777', DataColeta: '2026-08-15', Material: 'Urocultura', Microrganismo: 'Escherichia coli', MecanismoResistencia: '', StatusRevisao: 'pendente' }
  ],
  sensibilidade: [
    { ID_Cultura: 'CUL-1', Antibiotico: 'Meropenem', Resultado: 'R' },
    { ID_Cultura: 'CUL-1', Antibiotico: 'Amicacina', Resultado: 'S' },
    { ID_Cultura: 'CUL-2', Antibiotico: 'Ceftriaxona', Resultado: 'S' }
  ],
  pacientes: [
    { Prontuario: '0012345', Nome: 'MARIA DA SILVA' },
    { Prontuario: '777', Nome: 'JOÃO PEREIRA' }
  ]
};

(async () => {
  const dados = av.montarDadosAvaliacao(bancos, new Date().toISOString().slice(0, 10));
  const senha = 'ccih123';
  const cifrado = await av.criptografarDados(JSON.stringify(dados), senha);

  const deBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
  const chave = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: deBase64(cifrado.sal), iterations: 150000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const aberto = JSON.parse(new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(cifrado.iv) }, chave, deBase64(cifrado.dados))));
  if (aberto.pacientes.length !== dados.pacientes.length) throw new Error('ida-e-volta da criptografia falhou');
  let senhaErradaFalhou = false;
  try {
    const materialErrado = await crypto.subtle.importKey('raw', new TextEncoder().encode('errada'), 'PBKDF2', false, ['deriveKey']);
    const chaveErrada = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: deBase64(cifrado.sal), iterations: 150000, hash: 'SHA-256' },
      materialErrado, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(cifrado.iv) }, chaveErrada, deBase64(cifrado.dados));
  } catch (e) { senhaErradaFalhou = true; }
  if (!senhaErradaFalhou) throw new Error('senha errada deveria falhar');

  const html = av.gerarHTMLAvaliacao(cifrado, {
    geradoEm: new Date().toISOString(), emailDestino: 'ccih@exemplo.br',
    avisoHoras: av.AVALIACAO_AVISO_HORAS, bloqueioDias: av.AVALIACAO_BLOQUEIO_DIAS
  });
  const destino = path.join(__dirname, '..', 'amostras', 'avaliacao-teste.html');
  fs.writeFileSync(destino, html);
  console.log('criptografia ida-e-volta ok; senha errada rejeitada ok');
  console.log('gerado:', destino, `(${Math.round(html.length / 1024)} KB, ${dados.pacientes.length} pacientes, senha ccih123)`);
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
