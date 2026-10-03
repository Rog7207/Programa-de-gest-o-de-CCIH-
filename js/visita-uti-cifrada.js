/* Miniapp da visita à UTI gerado pelo aplicativo com a lista dos leitos de hoje dentro,
   CIFRADA com senha (mesmo esquema de avaliacao.js: AES-GCM, chave por PBKDF2). Pedido de
   03/10/2026: a visita acontece no celular, e o número digitado errado no miniapp fazia o
   paciente não casar na importação — com a lista, a enfermeira escolhe o leito e o
   prontuário vem certo. O modelo da página vem de js/miniapps-modelos.js, gerado por
   scripts/montar-miniapps.js a partir de miniapps/fonte/visita-uti.html (fonte única);
   os vocabulários entram por injetarVocabularios (js/miniapps-pasta.js).
   Usável no navegador e em Node. */

const VISITA_UTI_ARQUIVO = 'visita-uti-cifrada.html';
const VISITA_UTI_AVISO_HORAS = 48;
const VISITA_UTI_BLOQUEIO_DIAS = 7;

/* O que vai para o celular: só o necessário à visita, e nada que a tela não mostre.
   Texto da evolução aparado — a página inteira precisa caber num download de celular. */
const VISITA_UTI_TEXTO_MAX = 1200;
function montarDadosVisitaUTI(preparacao) {
  const pacientes = ((preparacao && preparacao.pacientes) || []).map(p => ({
    leito: p.leito, setor: p.setor, nome: p.nome, prontuario: p.prontuario, atendimento: p.atendimento,
    dias: p.dias, dispositivos: p.dispositivos || [], antibioticos: p.antibioticos || [],
    culturasPendentes: p.culturasPendentes || 0, isolamento: p.isolamento || '', irasAberta: p.irasAberta || '',
    sinaisInfeccao: p.sinaisInfeccao || '',
    vitais: (p.vitais || []).map(v => ({ sinal: v.sinal, data: v.data })),
    ultimaEvolucaoMedica: p.ultimaEvolucaoMedica ? {
      data: p.ultimaEvolucaoMedica.data, autor: p.ultimaEvolucaoMedica.autor,
      texto: String(p.ultimaEvolucaoMedica.texto || '').length > VISITA_UTI_TEXTO_MAX
        ? String(p.ultimaEvolucaoMedica.texto).slice(0, VISITA_UTI_TEXTO_MAX) + ' […]' : String(p.ultimaEvolucaoMedica.texto || '')
    } : null
  }));
  return { pacientes };
}

/* Monta a página: modelo + vocabulários desta instalação + bloco cifrado. `vocabulario` =
   { setores: [...], antibioticos: [...] } (config.vocabulario); vazio mantém o genérico. */
function gerarHTMLVisitaUTI(cifrado, meta, vocabulario) {
  if (typeof VISITA_UTI_MODELO !== 'string') throw new Error('js/miniapps-modelos.js não carregado — rode node scripts/montar-miniapps.js');
  let html = injetarVocabularios(VISITA_UTI_MODELO, vocabulario);
  /* "</" dentro de JSON fecharia o <script> da página — escapa. */
  const json = o => JSON.stringify(o).replace(/<\//g, '<\\/');
  if (!html.includes('<!--LISTA-CIFRADA-->')) throw new Error('modelo do miniapp sem o marcador <!--LISTA-CIFRADA-->');
  html = html.replace('<!--LISTA-CIFRADA-->', () => `<script>var CIFRADO = ${json(cifrado)}; var META = ${json(meta)};</script>`);
  return html;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { montarDadosVisitaUTI, gerarHTMLVisitaUTI, VISITA_UTI_ARQUIVO, VISITA_UTI_AVISO_HORAS, VISITA_UTI_BLOQUEIO_DIAS, VISITA_UTI_TEXTO_MAX };
}
