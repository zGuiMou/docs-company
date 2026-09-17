/* One-time local migration. Run: node migrate-to-supabase.js */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const dataFile = path.join(__dirname, 'data', 'docs-company.json');

async function migrate() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env local antes de executar.');
  }
  if (!fs.existsSync(dataFile)) throw new Error('Backup local não encontrado em data/docs-company.json.');

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const response = await fetch(`${supabaseUrl}/rest/v1/docs_company_state`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ id: 'main', data, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Supabase respondeu ${response.status}: ${await response.text()}`);

  console.log(`Migração concluída: ${data.companies?.length || 0} entidades, ${data.contracts?.length || 0} licitações e ${data.proposals?.length || 0} propostas.`);
}

migrate().catch(error => {
  console.error(`Falha na migração: ${error.message}`);
  process.exitCode = 1;
});
