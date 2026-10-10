import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { ItemConditionReports } from '../../../../src/app/(app)/items/[id]/_components/ItemConditionReports';
const asset = { status: 'MAINTENANCE', checkinReports: [
 { id: 'report1', type: 'DAMAGED', description: 'LCD cover is cracked. The display still turns on, but the hinge needs inspection before the next checkout.', imageUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="224" height="168"><rect width="224" height="168" fill="#e2e4e7"/><text x="112" y="85" font-family="Arial" font-size="18" text-anchor="middle" fill="#555">Sample evidence</text></svg>'), createdAt: '2026-10-03T16:00:00Z', reportedBy: { name: 'Sample reporter' }, booking: { id: 'checkout1', title: 'Soccer coverage' } },
 { id: 'report2', type: 'DAMAGED', description: 'Battery door does not latch securely.', imageUrl: null, createdAt: '2026-09-10T16:00:00Z', reportedBy: { name: 'Sample staff member' }, booking: { id: 'checkout2', title: 'Practice coverage' } },
] } as any;
const css = readdirSync('.next/build/static/css').filter(f=>f.endsWith('.css')).map(f=>readFileSync('.next/build/static/css/'+f,'utf8')).join('\n');
for (const status of ['MAINTENANCE','AVAILABLE']) {
 const view = renderToStaticMarkup(<main style={{maxWidth:1000,margin:'48px auto',padding:'0 24px'}}><p className="text-sm text-muted-foreground">ISOLATED COMPONENT FIXTURE · STAFF · SAMPLE DATA</p><h1 className="mt-4">Camera 01</h1><p className="text-muted-foreground">{status === 'MAINTENANCE' ? 'Needs Maintenance' : 'Available'}</p><ItemConditionReports asset={{...asset,status}} busy={false} onClearHold={()=>{}} onSelectBooking={()=>{}} /></main>);
 writeFileSync('tasks/archive/proofs/damaged-item-2026-10-03/'+status.toLowerCase()+'.html',`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>body{font-family:Arial,sans-serif}</style></head><body>${view}</body></html>`);
}
