/* Catálogo dos miniapps de celular — fonte ÚNICA para o cartão de Distribuição no
   aplicativo (Configurações) e para a página de QR codes (miniapps/apps.html, montada por
   scripts/montar-miniapps.js). Acrescentar um miniapp aqui basta: os dois lugares o
   mostram sozinhos.

   `url` vazia = arquivo ainda não publicado no Drive; quem exibe explica isso em vez de
   mostrar um QR quebrado. `arquivo: false` marca link de PASTA (não é download direto). */

const CATALOGO_MINIAPPS = [
  {
    titulo: 'Visita à UTI',
    para: 'Enfermagem e CCIH, à beira do leito',
    descricao: 'Registra dispositivos invasivos (CVC, VM, SVD), indicação de retirada e suspeita de IRAS '
      + 'em cada leito. Alimenta os indicadores de utilização de dispositivos e a fila de antibióticos.',
    url: 'https://drive.usercontent.google.com/download?id=1pFiQ82NVNAKbPMlX7uCp-5gilLqQEc2q&export=download',
    mensagem: 'CCIH — aplicativo de visita à UTI.\n\n1) Toque no link e BAIXE o arquivo.\n2) Abra-o pela pasta Downloads (ou ⋮ → Abrir com → Chrome).\n\nNão funciona na pré-visualização do Google Drive — precisa abrir no navegador. Depois de aberto funciona sem internet.'
  },
  {
    titulo: 'Higiene das mãos',
    para: 'Quem faz a auditoria de adesão',
    descricao: 'Marca as oportunidades observadas pelos 5 momentos da OMS, por categoria profissional e '
      + 'setor. Vira a taxa de adesão dos relatórios e do resumo da visita à UTI.',
    url: 'https://drive.usercontent.google.com/download?id=1ImY8epQS2Iqp1rxF_hxHw41Ff6bx4bzo&export=download',
    mensagem: 'CCIH — aplicativo de auditoria de higiene das mãos.\n\n1) Toque no link e BAIXE o arquivo.\n2) Abra-o pela pasta Downloads (ou ⋮ → Abrir com → Chrome).\n\nNão funciona na pré-visualização do Google Drive — precisa abrir no navegador. Depois de aberto funciona sem internet.'
  },
  {
    titulo: 'Decisão de ATB empírica',
    para: 'Médicos assistentes',
    descricao: 'O protocolo institucional de tratamento empírico no bolso: escolhe a síndrome, responde as '
      + 'perguntas e recebe o esquema, os exames antes da primeira dose e o ajuste renal. Registra as '
      + 'decisões do plantão e envia à CCIH — sai só o prontuário, nunca o nome do paciente.',
    url: 'https://drive.usercontent.google.com/download?id=1vP4sWK10UaoIYlcDAAdAe57SVeyC9Z6H&export=download',
    mensagem: 'CCIH — apoio à decisão de antibioticoterapia empírica, conforme o protocolo institucional.\n\n1) Toque no link e BAIXE o arquivo.\n2) Abra-o pela pasta Downloads (ou ⋮ → Abrir com → Chrome).\n\nFunciona sem internet. Registre as decisões do dia e toque em "Enviar decisões registradas à CCIH" ao fim do plantão/semana — sai só o prontuário, nunca o nome do paciente.'
  },
  {
    titulo: 'Avaliação de antimicrobianos',
    para: 'Médicos da CCIH, remotamente',
    descricao: 'Página cifrada com senha, publicada a cada rodada, com os pacientes em antibiótico '
      + 'aguardando parecer. As avaliações voltam para a fila de stewardship do aplicativo.',
    arquivo: false,
    url: 'https://drive.google.com/drive/folders/1dZuoG2xjoRwTGNedTp2PQfciG8wyAE2Z',
    mensagem: 'CCIH — pasta com a avaliação de antimicrobianos do dia. Baixe o arquivo mais recente e abra no navegador (a senha é fornecida pela CCIH):'
  }
];

if (typeof module !== 'undefined' && module.exports) module.exports = { CATALOGO_MINIAPPS };
