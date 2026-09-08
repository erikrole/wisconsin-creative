import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root=process.cwd();
const require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild');
const out=path.join(root,'tasks/archive/proofs/settings-ui15-2026-09-07');
const phase=process.argv[2];
if(!['before','after'].includes(phase)) throw Error('phase required');
const entry=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Toaster} from 'sonner';
import Rules from './src/app/(app)/settings/reservation-rules/page';
import Policies from './src/app/(app)/settings/checkout-policies/page';
import Appearance from './src/app/(app)/settings/appearance/page';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
const rules={advanceWindowDays:30,noShowExpiryHours:48,maxConcurrentReservations:5};
const policies={defaultLoanDays:3,gracePeriodHours:2,maxItemsPerUser:10};
window.fixture={client,readError:false,saveError:false,delay:0,writes:[],rules,policies};
window.fetch=async (input,opts={})=>{
 const url=String(input); const f=window.fixture;
 if(opts.method==='PUT'){
 f.writes.push(JSON.parse(opts.body));
 if(f.delay) await new Promise(resolve=>setTimeout(resolve,f.delay));
 if(f.saveError) return new Response(JSON.stringify({error:'Settings could not be saved. Try again.'}),{status:503});
 return Response.json({data:JSON.parse(opts.body)});
 }
 if(f.readError) throw new TypeError('Fixture offline');
 return Response.json({data:url.includes('reservation-rules')?rules:policies});
};
const which=new URLSearchParams(location.search).get('page');
const Page=which==='appearance'?Appearance:which==='rules'?Rules:Policies;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><main className="mx-auto max-w-4xl p-6"><p className="mb-6 text-xs text-muted-foreground">Wisconsin Creative · isolated Settings component fixture · Admin scenario</p><Page/></main><Toaster/></QueryClientProvider>);
`;
await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(out,phase+'.js'),platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},logLevel:'silent'});
const css=fs.readdirSync(path.join(root,'.next/static/css')).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(root,'.next/static/css',f),'utf8')).join('\n');
fs.writeFileSync(path.join(out,phase+'.css'),css);
fs.writeFileSync(path.join(out,phase+'.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settings UI component fixture</title><link rel="stylesheet" href="${phase}.css"></head><body><div id="root"></div><script src="${phase}.js"></script></body></html>`);
for(const name of ['reservation-rules','checkout-policies','appearance']) fs.writeFileSync(path.join(out,phase+'-'+name+'.txt'),fs.readFileSync(path.join(root,'src/app/(app)/settings',name,'page.tsx')));
console.log('Built '+phase+' fixture from actual source');
