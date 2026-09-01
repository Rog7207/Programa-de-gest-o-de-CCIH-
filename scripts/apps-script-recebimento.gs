/**
 * CCIH — Recebimento dos miniapps direto no Google Drive.
 *
 * COMO IMPLANTAR (uma única vez, ~5 minutos):
 * 1. Abra https://script.google.com logado como a conta Google da CCIH
 *    → "Novo projeto" → apague o conteúdo e cole este arquivo inteiro.
 * 2. Menu "Implantar" → "Nova implantação" → tipo "App da Web":
 *    - Executar como: Eu (a conta Google da CCIH)
 *    - Quem pode acessar: Qualquer pessoa
 *    → "Implantar" e autorize as permissões pedidas.
 * 3. Copie a "URL do app da Web" (termina em /exec) e me envie —
 *    eu a coloco nos miniapps (constante ENVIO_URL).
 *
 * Os arquivos chegarão em: Meu Drive > CCIH > Recebidos dos miniapps
 */

const PASTA_ID = '1gchsYcnEogZS5mzm8V2OK3MC_UEqluhu';
const SEGREDO = 'troque-este-segredo';  // use o MESMO valor do config-local.json dos miniapps

function doPost(e) {
  try {
    const dados = JSON.parse(e.postData.contents);
    if (dados.segredo !== SEGREDO) return resposta({ ok: false, erro: 'segredo inválido' });
    const nome = String(dados.nome || 'ccih.csv').replace(/[^\w.\-]+/g, '_');
    DriveApp.getFolderById(PASTA_ID).createFile(nome, String(dados.conteudo || ''), 'text/csv');
    return resposta({ ok: true, nome: nome });
  } catch (erro) {
    return resposta({ ok: false, erro: String(erro) });
  }
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
