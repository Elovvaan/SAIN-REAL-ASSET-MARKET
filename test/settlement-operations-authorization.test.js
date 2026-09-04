import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createOperationsAuthorization } from '../middleware/operations-authorization.js';

test('private administrator session hydrates settlement-rail operations identity',async()=>{
  const accessService={async getSession(token){return token==='private-token'?{id:'ADMIN-1',email:'admin@sra.test',activeCapacity:'PLATFORM_ADMIN',capacities:[],roles:[]}:null;}};
  const app=express();
  app.use(createOperationsAuthorization({accessServiceProvider:async()=>accessService}));
  app.post('/api/settlement-rails/stellar-usdc/sep24/sandbox-tests',(req,res)=>res.json({actorId:req.sraOperationsAuth?.actorId,source:req.sraOperationsAuth?.source}));
  const response=await request(app).post('/api/settlement-rails/stellar-usdc/sep24/sandbox-tests').set('Cookie','sra_admin_session=private-token').expect(200);
  assert.deepEqual(response.body,{actorId:'ADMIN-1',source:'PRIVATE_ADMIN_SESSION'});
});

test('anonymous settlement-rail write is rejected by operations authorization',async()=>{
  const app=express();
  app.use(createOperationsAuthorization({accessServiceProvider:async()=>({async getSession(){return null;}})}));
  app.post('/api/settlement-rails/stellar-usdc/sep24/sandbox-tests',(_req,res)=>res.sendStatus(204));
  await request(app).post('/api/settlement-rails/stellar-usdc/sep24/sandbox-tests').expect(401);
});
