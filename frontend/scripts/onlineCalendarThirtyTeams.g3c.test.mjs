import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/online/onlineApi.js',import.meta.url),'utf8');
test('custom league UI rejects every team count except exactly 30',()=>{
 assert.match(src,/names\.length !== 30/);
 assert.doesNotMatch(src,/names\.length < 2 \|\| names\.length > 64/);
});
test('no one can bypass team-count enforcement by creating an online lobby directly',()=>{
 const sql=readFileSync(new URL('../../supabase/BM_G3C_H1_THIRTY_TEAMS_MANUAL.sql',import.meta.url),'utf8');
 assert.match(sql,/create_new text := 'array_length\(p_team_names,1\) <> 30'/);
 assert.match(sql,/launch_new text/);
 assert.match(sql,/EXECUTE pg_catalog.replace\(create_def/);
 assert.match(sql,/EXECUTE pg_catalog.replace\(launch_def/);
});
