import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {isSupportedOnlineCpuTradeYear} from '../src/online/onlineCpuTradeYear.mjs';
const dir=dirname(fileURLToPath(import.meta.url));
const src=name=>readFileSync(resolve(dir,'../src/online',name),'utf8');
test('G3A1 exposes only the three seasons supported by the trusted CPU backend',()=>{
  for(const year of [2026,2027,2028])assert.equal(isSupportedOnlineCpuTradeYear(year),true);
  for(const year of [undefined,null,NaN,2025,2029,2030,2027.5,'2028'])
    assert.equal(isSupportedOnlineCpuTradeYear(year),false);
});
for(const name of ['OnlineCpuTradeFinder.jsx','OnlineCpuTradeRoom.jsx']){
  test(`${name} uses the bounded CPU year hint instead of 2026-only disable`,()=>{
    const body=src(name);
    assert.match(body,/import \{isSupportedOnlineCpuTradeYear\} from '\.\/onlineCpuTradeYear\.mjs';/);
    assert.match(body,/const supportedCpuSeason=isSupportedOnlineCpuTradeYear\(year\);/);
    assert.match(body,/const ready=[^;]*supportedCpuSeason/);
    assert.doesNotMatch(body,/year===2026|year!==2026/);
    assert.match(body,/!supportedCpuSeason&&/);
  });
}
test('frontend never treats a suggestion as accepted and CPU commits remain server-authoritative',()=>{
  assert.match(src('OnlineCpuTradeFinder.jsx'),/suggestions are provisional/i);
  assert.match(src('OnlineCpuTradeRoom.jsx'),/\/api\/online\/cpu-trade/);
  assert.match(src('OnlineCpuTradeRoom.jsx'),/if\(result\.committed\|\|result\.replayed\)/);
});
