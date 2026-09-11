import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const file=(name,text)=>({name,mimeType:'text/csv',buffer:Buffer.from(text)});
async function ready(page){page.on('pageerror',e=>console.log('PAGE ERROR',e.message));page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()));await page.goto('/');await expect(page.locator('#status')).toHaveText('Ready.',{timeout:150000});await expect(page.locator('#application')).not.toHaveAttribute('disabled','');}
async function settled(page){await expect(page.locator('#application')).not.toHaveAttribute('disabled','');await expect(page.locator('#status')).not.toHaveClass('error');}
test('planner placement, fresh startup, both clear actions, JSON roundtrip, and CSV export',async({page})=>{
 await ready(page);await expect(page.locator('header strong')).toHaveText('Coastal Healing');await page.locator('#strain').fill('Test strain');await page.locator('#count').fill('12');await page.locator('#batch-form button').click();await expect(page.locator('.batch')).toContainText('12 unplaced');await page.locator('.table').first().click();await expect(page.locator('#summary')).toContainText('10 /');await settled(page);
 await expect(page.locator('.plant.occupied').first()).toHaveText('TEST');
 const savedEvent=page.waitForEvent('download');await page.locator('#save').click();const saved=await savedEvent;const data=await readFile(await saved.path(),'utf8');expect(JSON.parse(data).batches[0].strain).toBe('Test strain');await settled(page);
 await page.evaluate(content=>localStorage.setItem('coastal-layout',content),data);
 await page.reload();await expect(page.locator('#application')).not.toHaveAttribute('disabled','',{timeout:150000});await expect(page.locator('#summary')).toContainText('0 /');await expect(page.locator('.batch')).toHaveCount(0);
 await page.locator('#layout-file').setInputFiles(file('layout.json',data));await expect(page.locator('#summary')).toContainText('10 /');await settled(page);
 const csvEvent=page.waitForEvent('download');await page.locator('#export').click();const csv=await csvEvent;expect(await readFile(await csv.path(),'utf8')).toContain('Test strain');await settled(page);
 page.once('dialog',d=>d.accept());await page.locator('#clear').click();await expect(page.locator('#summary')).toContainText('0 /');await expect(page.locator('.batch')).toContainText('12 unplaced');await settled(page);
 page.once('dialog',d=>d.accept());await page.locator('#layout-file').setInputFiles(file('layout.json',data));await expect(page.locator('#summary')).toContainText('10 /');await settled(page);
 await page.locator('#strain').fill('Second strain');await page.locator('#batch-form button').click();await expect(page.locator('.batch')).toHaveCount(2);await settled(page);
 const room=await page.locator('#room').inputValue();const capacity=await page.locator('.plant').count();
 page.once('dialog',d=>d.dismiss());await page.locator('#clear-all').click();await expect(page.locator('.batch')).toHaveCount(2);
 page.once('dialog',d=>d.accept());await page.locator('#clear-all').click();await settled(page);await expect(page.locator('.batch')).toHaveCount(0);await expect(page.locator('.plant.occupied')).toHaveCount(0);await expect(page.locator('#room')).toHaveValue(room);await expect(page.locator('.plant')).toHaveCount(capacity);
 await page.screenshot({path:'test-results/planner.png',fullPage:true});
});
test('clone and harvest downloads plus invalid input',async({page})=>{
 await ready(page);await page.getByRole('button',{name:'Clone batches',exact:true}).click();const strain=await page.locator('#strains option').first().getAttribute('value');
 await page.locator('#clone-form [name=name]').fill('Test');await page.locator('#clone-form [name=date]').fill('2026-09-09');await page.locator('#clone-form [name=input]').setInputFiles(file('clones.csv',`${strain},12\n`));await page.locator('#clone-form [name=inventory]').setInputFiles(file('inventory.csv',`Strain,Tag\n${strain},ABC123\n`));
 const cloned=page.waitForEvent('download');await page.locator('#clone-form button').click();const csv=await readFile(await(await cloned).path(),'utf8');expect(csv).toContain('ABC123,Test-');expect(csv).toContain(',clone,12,');await settled(page);
 await page.locator('#clone-form [name=input]').setInputFiles(file('bad.csv',`${strain},101\n`));await page.locator('#clone-form button').click();await expect(page.locator('#status')).toContainText('between 1 and 100');
 await page.getByRole('button',{name:'Harvest',exact:true}).click();await page.locator('#harvest-form [name=name]').fill('Harvest');await page.locator('#harvest-form [name=date]').fill('2026-09-09');await page.locator('#harvest-form [name=input]').setInputFiles(file('harvest.csv','ABC123,125.5,TEST\n'));const harvested=page.waitForEvent('download');await page.locator('#harvest-form button').click();expect(await readFile(await(await harvested).path(),'utf8')).toContain('ABC123,125.5,Grams,Dry room,,Harvest-TEST-20260909,B122507,2026-09-09');
});
test('room design, resize, catalog and CSV import',async({page})=>{
 await ready(page);await page.locator('#design-open').click();await page.locator('#design-form [name=name]').fill('Test room');await page.locator('#design-form button.primary').click();await expect(page.locator('#room')).toHaveValue('Test room');await settled(page);
 await page.locator('.table-top button').first().click();await page.locator('#resize-form [name=capacity]').fill('7');await page.locator('#resize-form button.primary').click();await expect(page.locator('.table').first().locator('.plant')).toHaveCount(7);await settled(page);
 await page.locator('#strain-open').click();await page.locator('#strain-form [name=name]').fill('Browser strain');await page.locator('#strain-form [name=abbreviation]').fill('BRS');await page.locator('#strain-form button.primary').click();await settled(page);await page.locator('#inventory-file').setInputFiles(file('batches.csv','strain,count\nBrowser strain,20\n'));await expect(page.locator('.batch')).toContainText('20 unplaced');await settled(page);
 await page.locator('.table').first().click();await settled(page);await expect(page.locator('.plant.occupied').first()).toHaveText('BRS');
 await expect(page.getByRole('link', { name: 'Supply' })).toHaveAttribute('href', 'supply/');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Excel inventory import aggregates counts and preserves batches',async({page})=>{
 await ready(page);await page.locator('#inventory-file').setInputFiles('tests/fixtures/inventory.xlsx');await expect(page.locator('.batch')).toContainText('Excel strain',{timeout:30000});await expect(page.locator('.batch')).toContainText('12 unplaced');await settled(page);
 await page.locator('#inventory-file').setInputFiles('tests/fixtures/inventory.xlsx');await expect(page.locator('.batch')).toHaveCount(2);await settled(page);
});
test('whole room fits, table contents swap and clear, batch usage updates, and layout prints',async({page})=>{
 await ready(page);
 for(const size of [{width:1280,height:720},{width:390,height:844}]){
  await page.setViewportSize(size);
  await expect.poll(()=>page.evaluate(()=>{
   const view=document.querySelector('#room-viewport').getBoundingClientRect();
   return [...document.querySelectorAll('#room-view .table')].every(node=>{const r=node.getBoundingClientRect();return r.left>=view.left-1&&r.right<=view.right+1&&r.top>=view.top-1&&r.bottom<=view.bottom+1&&r.bottom<=innerHeight;})&&document.documentElement.scrollWidth<=innerWidth;
  })).toBe(true);
 }
 await page.setViewportSize({width:1280,height:800});
 await expect.poll(()=>page.evaluate(()=>{const r=document.querySelector('#room-viewport').getBoundingClientRect();const b=document.querySelector('#planner-batches').getBoundingClientRect();return r.width>innerWidth*.7&&r.height>innerHeight*.65&&b.right<=r.left;})).toBe(true);
 await expect(page.locator('#planner-batches')).toBeVisible();
 const add=async(strain,count)=>{await page.locator('#strain').fill(strain);await page.locator('#count').fill(String(count));await page.locator('#batch-form button').click();await settled(page);await page.locator('.batch').last().click();};
 const tables=page.locator('#room-view .table');
 await add('Alpha',3);await tables.nth(0).click();await settled(page);
 await add('Beta',2);await tables.nth(1).click();await settled(page);
 await tables.nth(0).getByRole('button',{name:'Move',exact:true}).dragTo(tables.nth(1));
 await expect(tables.nth(0).locator('.occupied')).toHaveCount(2);await expect(tables.nth(1).locator('.occupied')).toHaveCount(3);
 await expect(tables.nth(1).locator('.occupied').first()).toHaveText('ALPH');
 await expect(page.locator('#batch-totals')).toContainText('Alpha: 3 placed / 3 total');
 await tables.nth(1).getByRole('button',{name:'Move',exact:true}).click();await tables.nth(2).click();await settled(page);
 await expect(tables.nth(1).locator('.occupied')).toHaveCount(0);await expect(tables.nth(2).locator('.occupied')).toHaveCount(3);
 await tables.nth(0).getByRole('button',{name:'Clear',exact:true}).click();await settled(page);
 await expect(page.locator('#batch-totals')).toContainText('Beta: 0 placed / 2 total');await expect(page.locator('#summary')).toContainText('3 /');
 await page.evaluate(()=>{window.print=()=>{window.printCalled=true;};});await page.locator('#print-layout').click();expect(await page.evaluate(()=>window.printCalled)).toBe(true);
 await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));await page.emulateMedia({media:'print'});
 await expect(page.locator('#room-view')).toBeVisible();await expect(page.locator('aside')).toBeHidden();
 const pdf=await page.pdf({path:'test-results/room-layout.pdf',preferCSSPageSize:true,printBackground:true});
 expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
 await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
 await page.screenshot({path:'test-results/room-layout-updated.png',fullPage:true});
});
