import test from 'node:test';
import assert from 'node:assert/strict';
import { SraAgentService } from '../services/sra-agent-service.js';

test('SANE instructions preserve authoritative record separation, Verified Value, and Coin Position asset status',()=>{
  const service=new SraAgentService({
    persistentDomain:{snapshot:()=>({counts:{}})},
    marketplace:null,
    ledgerService:null,
    treasuryService:null,
    financialStatementsService:null,
    assetServicingService:null,
    institutionBillingService:null,
    economicsService:null,
    homeFinancingService:null,
    settlementService:null,
    client:{responses:{create:async()=>({id:'resp-test',output_text:'ok'})}}
  });
  const instructions=service.instructions();
  assert.match(instructions,/Asset Account is the platform record/i);
  assert.match(instructions,/Project Account is a separate record/i);
  assert.match(instructions,/Verified Value is SRA's current supported value measurement/i);
  assert.match(instructions,/Verified Value is not cash/i);
  assert.match(instructions,/eligible Financial Record represented as an SRA Coin Position is a platform-recognized digital financial asset/i);
  assert.match(instructions,/does not depend on whether it has traded/i);
  assert.match(instructions,/Trading establishes a transaction price and ownership event/i);
  assert.match(instructions,/must not reduce an SRA Coin Position to merely a receipt, database entry, symbolic record, or non-asset/i);
  assert.match(instructions,/Do not end with the phrase “If you want.”/i);
});
