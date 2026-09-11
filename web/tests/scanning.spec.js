import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function setup(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Ready.', {timeout:150000});
  await page.locator('#strain').fill('Scanning strain');
  await page.locator('#count').fill('100');
  await page.locator('#batch-form button').click();
  await expect(page.locator('.batch')).toContainText('100 unplaced');
  await page.locator('.table-top button').first().click();
  await page.locator('#resize-form [name=capacity]').fill('32');
  await page.locator('#resize-form button.primary').click();
  await expect(page.locator('.table').first().locator('.plant')).toHaveCount(32);
  await page.locator('.table').first().click();
  await expect(page.locator('#summary')).toContainText('32 /');
  await page.locator('[data-tab=scanning]').click();
}
test('32 placed plants, repeated scans, completion boundary, undo and manual corrections',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{ window.beeps=0; scanning.beep=async()=>{window.beeps++;}; });
  await expect(page.locator('#scan-progress')).toContainText('0 / 32');
  await page.locator('#scan-start').click();
  for(let i=0;i<31;i++) { await page.locator('#scan-tag').fill('TAG'); await page.locator('#scan-tag').press('Enter'); }
  await expect(page.locator('#scan-progress')).toContainText('31 / 32');
  await expect(page.locator('.scan-batch')).toHaveText('SCAN 31/32');
  expect(await page.evaluate(()=>window.beeps)).toBe(0);
  await page.locator('#scan-tag').fill('LAST'); await page.locator('#scan-tag').press('Enter');
  await expect(page.locator('#scan-progress')).toContainText('32 / 32 plants — Batch satisfied');
  expect(await page.evaluate(()=>window.beeps)).toBe(1);
  await expect(page.locator('#scan-completed')).toBeVisible();
  await expect(page.locator('#scan-completed-title')).toHaveText('BATCHCOMPLETED');
  await expect(page.locator('#scan-completed-detail')).toContainText('32/32 plants');
  await page.screenshot({path:'test-results/completion.png',fullPage:true});
  await page.locator('#scan-completed-close').click();
  await expect(page.locator('#scan-add')).toBeDisabled();
  await page.locator('#scan-undo-count').fill('2'); await page.locator('#scan-undo').click();
  await expect(page.locator('#scan-progress')).toContainText('30 / 32');
  await page.locator('#scan-add').click(); await page.locator('#scan-add').click();
  expect(await page.evaluate(()=>window.beeps)).toBe(2);
  await expect(page.locator('#scan-completed')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#scan-completed')).not.toBeVisible();
  await page.locator('[data-tab=planner]').click(); await page.locator('[data-tab=scanning]').click();
  await expect(page.locator('#scan-progress')).toContainText('32 / 32');
  await page.locator('[data-tab=planner]').click(); await page.locator('.plant.occupied').first().click();
  await expect(page.locator('#summary')).toContainText('31 /');
  await page.locator('[data-tab=scanning]').click();
  await expect(page.locator('#scan-progress')).toContainText('0 / 31');
  await expect(page.locator('#scan-message')).toContainText('Affected batches have been reset');
  await page.locator('#scan-add').click();
  await page.locator('[data-tab=planner]').click();
  const layoutColor = await page.locator('.plant.occupied').first().evaluate(el=>getComputedStyle(el).backgroundColor);
  const layoutAbbreviation = await page.locator('.plant.occupied').first().textContent();
  await page.locator('#strain').fill('Second strain');
  await page.locator('#count').fill('5');
  await page.locator('#batch-form button').click();
  await expect(page.locator('.batch')).toHaveCount(2);
  await page.locator('.batch').nth(1).click();
  await page.locator('.table').nth(1).click();
  await expect(page.locator('#summary')).toContainText('36 /');
  await page.locator('[data-tab=scanning]').click();
  const buttons = page.locator('.scan-batch');
  await expect(buttons).toHaveCount(2);
  expect(await buttons.first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(layoutColor);
  await expect(buttons.first()).toHaveText(`${layoutAbbreviation} 1/31`);
  expect(await buttons.first().evaluate(el=>getComputedStyle(el).height)).toBe('30px');
  expect(await buttons.first().evaluate(el=>getComputedStyle(el).borderRadius)).toBe('4px');
  await expect(buttons.first()).toContainText('1/31');
  await expect(buttons.nth(1)).toContainText('0/5');
  await buttons.nth(1).click();
  await expect(buttons.nth(1)).toHaveAttribute('aria-pressed','true');
  await page.locator('#scan-add').click();
  await expect(buttons.nth(1)).toContainText('1/5');
  await buttons.first().click();
  await expect(page.locator('#scan-progress')).toContainText('1 / 31');
  await page.screenshot({path:'test-results/scanning-tiles.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

});
test('completion song plays once at test and once at target',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{
    window.plays=[];
    Audio.prototype.play = function() { window.plays.push(this.src); return Promise.resolve(); };
  });
  await page.locator('#scan-test').click();
  await expect.poll(()=>page.evaluate(()=>window.plays.length)).toBe(1);
  await page.locator('#scan-start').click();
  for(let i=0;i<31;i++) { await page.locator('#scan-tag').fill('TAG'); await page.locator('#scan-tag').press('Enter'); }
  expect(await page.evaluate(()=>window.plays.length)).toBe(1);
  await page.locator('#scan-tag').fill('LAST'); await page.locator('#scan-tag').press('Enter');
  await expect(page.locator('#scan-progress')).toContainText('Batch satisfied');
  await expect.poll(()=>page.evaluate(()=>window.plays.length)).toBe(2);
  await expect(page.locator('#scan-completed')).toBeVisible();
  await page.locator('#scan-completed-close').click();
  await page.evaluate(()=>{Audio.prototype.play = function() { return Promise.reject(new Error('blocked')); };});
  await page.locator('#scan-test').click();
  await expect(page.locator('#scan-sound-status')).toContainText('Sound unavailable');
  await expect(page.locator('#scan-progress')).toContainText('Batch satisfied');
});

test('move CSV preserves tags, excludes undo, and survives reload with earlier room details',async({page})=>{
  await setup(page);
  await expect(page.locator('#scan-export')).toBeDisabled();
  const room=await page.locator('#scan-room').textContent();
  await page.locator('#scan-start').click();
  const tags=['000123456789012345678901','TAG,"quoted"','000123456789012345678901','UNDO-ME'];
  for(const tag of tags) { await page.locator('#scan-tag').fill(tag); await page.locator('#scan-tag').press('Enter'); }
  await page.locator('#scan-undo').click();
  await page.locator('#scan-add').click();
  await expect(page.locator('#scan-record-status')).toContainText('4 move entries saved');
  async function csv() {
    const event=page.waitForEvent('download');
    await page.locator('#scan-export').click();
    return readFile(await (await event).path(),'utf8');
  }
  const first=await csv();
  expect(first).toContain('"Plant tag"');
  expect(first.split('\r\n')).toHaveLength(6);
  expect(first.match(/000123456789012345678901/g)).toHaveLength(2);
  expect(first).toContain('"TAG,""quoted"""');
  expect(first).not.toContain('UNDO-ME');
  expect(first).toContain('"Manual addition - no tag",""');
  expect(first).toContain(`"${room}"`);
  expect(first).toContain('"Scanning strain","SCAN","32"');
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Ready.',{timeout:150000});
  await expect(page.locator('.scan-batch')).toHaveCount(0);
  await expect(page.locator('#scan-record-status')).toContainText('4 move entries saved');
  expect(await csv()).toBe(first);
});
test('storage failure keeps current scans exportable and displays a warning',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('quota');};});
  await page.locator('#scan-add').click();
  await expect(page.locator('#scan-record-status')).toContainText('Download the CSV now');
  const event=page.waitForEvent('download'); await page.locator('#scan-export').click();
  const text=await readFile(await (await event).path(),'utf8');
  expect(text).toContain('"Manual addition - no tag",""');
});
