import copy
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'public' / 'python'))
import free_agency_logic as fa
import draft_logic as draft
checks = 0
def check(condition, label):
    global checks
    assert condition, label
    checks += 1
    print('PASS ' + label)
def player(name, year, ovr=75):
    return {'id':name,'name':name,'pos':'SG','age':26,'overall':ovr,'potential':ovr+3,'contract':{'startYear':year,'salaryByYear':[5000000],'option':None}}
def league(year):
    return {'seasonYear':year,'contractSeasonYear':year,'salaryCap':160000000,'conferences':{'East':[{'name':'Milwaukee Bucks','players':[player('Expired',year-1),player('Signed',year)]}],'West':[]},'freeAgents':[player('Leftover',year-2)],'freeAgencyState':{'seasonYear':year-1,'completed':True}}
for year in [2027,2028,2029]:
    l=league(year)
    check(not fa.audit_pre_free_agency_roster_contract_cleanup_needed(l,year)['ok'],f'{year}: expired contracts detected')
    result=fa.apply_offseason_contract_decisions(l,None,{})
    check(result['ok'],f'{year}: options cleanup succeeds')
    updated=result['leagueData']
    check('Expired' in [p['name'] for p in updated['freeAgents']],f'{year}: new FA joins existing pool')
    check('Signed' in [p['name'] for p in updated['conferences']['East'][0]['players']],f'{year}: signed player stays rostered')
    check(fa.audit_pre_free_agency_roster_contract_cleanup_needed(updated,year)['ok'],f'{year}: market audit clears')
    again=fa.apply_offseason_contract_decisions(updated,None,{})
    check(sum(p['name']=='Expired' for p in again['leagueData']['freeAgents'])==1,f'{year}: retry does not duplicate FA')
def prospect(ovr,pot,rank=1,pos='SG'):
    return {'id':str(ovr)+str(pot),'name':'Prospect','overall':ovr,'potential':pot,'age':19,'pos':pos,'draftProjection':rank}
score=lambda p,t: draft._prospect_score(p,t,None,{},None)
empty={'players':[]}
check(abs(score(prospect(75,90),empty)-score(prospect(74,90),empty))<2,'CPU score has no 75 OVR cliff')
check(score(prospect(74,92,1),empty)>score(prospect(69,86,6),empty),'Elite talent beats clearly weaker prospect')
crowded={'players':[{'pos':'SG','overall':90} for _ in range(6)]}
check(score(prospect(74,92,1),crowded)>score(prospect(69,86,6,'C'),crowded),'Roster fit cannot justify large reach')
print(f'Offseason Python regression passed: {checks}/{checks}.')
