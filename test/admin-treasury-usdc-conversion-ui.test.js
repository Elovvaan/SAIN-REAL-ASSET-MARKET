import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import { createPlatformTreasuryRouter } from '../routes/platform-treasury-router.js';

const ui=fs.readFileSync(new URL('../public/admin/admin-treasury-workstation.js',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../routes/platform-treasury-router.js',import.meta.url),'utf8');

test('Treasury Wallets exposes the governed USD to Stellar USDC lifecycle',()=>{
  assert.match(ui,/Treasury Wallets & Stellar USDC/);
  assert.match(ui,/Authorization alone does not create USDC/);
  for(const action of ['initiate','confirm-usd-funding','confirm-usdc-receipt','reconcile','reclassify'])assert.match(router,new RegExp(action));
  assert.match(router,/Authenticated SRA treasury identity is required/);
});

test('Treasury conversion API requires identity and exposes the lifecycle record',async()=>{
  const conversion={conversionId:'TUC-1',state:'AUTHORIZED'};
  const conversions={list:()=>[conversion],get:()=>conversion,authorize:async(_body,actor)=>({...conversion,authorizedBy:actor})};
  const app=express();app.use(express.json());app.use('/api/platform-treasury',createPlatformTreasuryRouter({},conversions));
  await request(app).post('/api/platform-treasury/usdc-conversions').send({}).expect(401);
  const created=await request(app).post('/api/platform-treasury/usdc-conversions').set('x-sra-actor-id','ADMIN').send({}).expect(201);
  assert.equal(created.body.authorizedBy,'ADMIN');
  const listed=await request(app).get('/api/platform-treasury/usdc-conversions').expect(200);
  assert.equal(listed.body.conversions[0].conversionId,'TUC-1');
});
