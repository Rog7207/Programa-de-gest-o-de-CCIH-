/* ---- Arquivo morto (27/11/2026) ----
   O banco do dia a dia fica com o ano corrente + o ano anterior inteiro; o que é mais antigo
   vai para arquivo/<banco>-ate-AAAA.xlsx, só para leitura (ficha do paciente, perfil e
   relatório microbiológico, busca de pacientes). Só os dois bancos que pesam por causa da
   IDADE entram: pacientes (cadastro + internações) e culturas (+ sensibilidade). Evoluções,
   passagens e antibióticos já são recentes — o peso deles é volume diário, não idade.

   Nunca vai para o arquivo, mesmo antiga:
   - cultura pendente de revisão, ligada a IRAS (ID_IRAS ou agente da IRAS), a surto ou a
     decisão de isolamento;
   - internação sem alta, ou com alta a partir do corte;
   - cadastro de paciente que aparece em QUALQUER outra tabela que fica no banco (IRAS de
     todos os anos, cirurgias, antibióticos, isolamentos, sepse, surtos, UTI, evoluções,
     dispositivos, SINAN, passagens, óbitos) ou nas internações/culturas que ficaram.
   Função pura: recebe os bancos lidos e devolve o que fica e o que sai. */

/* Quem referencia prontuário/cultura e fica sempre no banco ativo. */
const ARQUIVO_MORTO_REFERENCIAS = [
  ['pacientes', 'obitos'], ['iras', 'casos'], ['cirurgias', 'cirurgias'], ['antibioticos', 'prescricoes'],
  ['antibioticos', 'avaliacoes'], ['antibioticos', 'decisoes_empiricas'], ['isolamentos', 'precaucoes'],
  ['isolamentos', 'decisoes'], ['sepse', 'casos'], ['surtos', 'pacientes_surto'], ['uti', 'visitas'],
  ['uti', 'avaliacoes_atb'], ['evolucoes', 'evolucoes'], ['evolucoes', 'sinais_vitais'], ['evolucoes', 'corpus'],
  ['dispositivos', 'dispositivos'], ['dispositivos', 'checklists'], ['sinan', 'notificacoes'], ['sinan', 'casos'],
  ['denominadores', 'passagem_setor']
];

/* Corte padrão: 1º de janeiro do ano anterior ao de `hoje` (em 2026, fica 2025 em diante). */
function corteArquivoMorto(hoje) {
  const ano = Number(String(hoje || '').slice(0, 4));
  return isFinite(ano) && ano > 2000 ? `${ano - 1}-01-01` : '';
}

function separarArquivoMorto(bancos, corte) {
  const np = typeof normalizarProntuario === 'function' ? normalizarProntuario : (v => String(v == null ? '' : v).trim());
  const antes = v => { const d = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < corte; };
  const b = bancos || {};
  const lista = (banco, aba) => ((b[banco] || {})[aba]) || [];

  /* culturas presas a algo que fica no banco */
  const culturasPresas = new Set();
  lista('iras', 'casos').forEach(c => { if (c.ID_CulturaAgente) culturasPresas.add(String(c.ID_CulturaAgente)); });
  lista('surtos', 'pacientes_surto').forEach(p => { if (p.ID_Cultura) culturasPresas.add(String(p.ID_Cultura)); });
  lista('isolamentos', 'decisoes').forEach(d => { if (d.ID_Cultura) culturasPresas.add(String(d.ID_Cultura)); });

  const culturas = { fica: [], sai: [] };
  for (const c of lista('culturas', 'culturas')) {
    const sai = antes(c.DataColeta) && String(c.StatusRevisao || '') !== 'pendente'
      && !String(c.ID_IRAS || '').trim() && !culturasPresas.has(String(c.ID_Cultura));
    (sai ? culturas.sai : culturas.fica).push(c);
  }
  const idsSaem = new Set(culturas.sai.map(c => String(c.ID_Cultura)));
  const sensibilidade = { fica: [], sai: [] };
  for (const s of lista('culturas', 'sensibilidade')) (idsSaem.has(String(s.ID_Cultura)) ? sensibilidade.sai : sensibilidade.fica).push(s);

  const internacoes = { fica: [], sai: [] };
  for (const i of lista('pacientes', 'internacoes')) {
    const alta = String(i.DataAlta || '').trim();
    const sai = antes(i.DataInternacao) && !!alta && antes(alta);
    (sai ? internacoes.sai : internacoes.fica).push(i);
  }

  /* prontuários que continuam em uso */
  const emUso = new Set();
  const marcar = l => { const p = np(l.Prontuario); if (p) emUso.add(p); };
  culturas.fica.forEach(marcar);
  internacoes.fica.forEach(marcar);
  for (const [banco, aba] of ARQUIVO_MORTO_REFERENCIAS) lista(banco, aba).forEach(marcar);
  const cadastro = { fica: [], sai: [] };
  for (const p of lista('pacientes', 'pacientes')) (emUso.has(np(p.Prontuario)) ? cadastro.fica : cadastro.sai).push(p);

  return {
    corte,
    ativo: {
      pacientes: { pacientes: cadastro.fica, internacoes: internacoes.fica },
      culturas: { culturas: culturas.fica, sensibilidade: sensibilidade.fica }
    },
    morto: {
      pacientes: { pacientes: cadastro.sai, internacoes: internacoes.sai },
      culturas: { culturas: culturas.sai, sensibilidade: sensibilidade.sai }
    },
    contagem: {
      pacientes: cadastro.sai.length, internacoes: internacoes.sai.length,
      culturas: culturas.sai.length, sensibilidade: sensibilidade.sai.length
    }
  };
}

/* Junta o que já estava no arquivo com o que sai agora, sem repetir (pela 1ª coluna-chave). */
function mesclarNoArquivoMorto(existente, novas, chave) {
  const vistos = new Set((existente || []).map(l => String(l[chave])));
  return (existente || []).concat((novas || []).filter(l => !vistos.has(String(l[chave]))));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { separarArquivoMorto, corteArquivoMorto, mesclarNoArquivoMorto, ARQUIVO_MORTO_REFERENCIAS };
}
