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
