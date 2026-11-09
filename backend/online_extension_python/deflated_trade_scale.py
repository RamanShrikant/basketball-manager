"""BM Patch 33 contract economic scale helpers."""
from __future__ import annotations
from typing import Any, Dict
import math
BM_PATCH33_CONTRACT_SCALE_VERSION = "patch33_contract_market_parity_v1"
TRADE_TIER = {"DEPTH":65,"BENCH":68,"ROTATION":70,"GOOD_ROTATION":73,"STARTER":76,"CORE":80,"STAR":84,"MEGA":86,"SUPERSTAR":88,"FRANCHISE":90}
_ECONOMY_POINTS=[(50.0,55.0),(55.0,60.0),(60.0,66.0),(65.0,71.5),(68.0,75.0),(69.0,75.5),(70.0,76.0),(72.0,77.5),(73.0,78.5),(75.0,80.0),(76.0,81.0),(80.0,84.0),(82.0,86.0),(85.0,89.0),(88.0,92.0),(90.0,94.0),(92.0,95.5),(95.0,97.0),(99.0,99.0)]
def _num(value: Any, fallback: float=0.0)->float:
    try:
        n=float(value); return n if math.isfinite(n) else float(fallback)
    except Exception: return float(fallback)
def economy_ovr(visible_overall: Any=0)->float:
    x=_num(visible_overall,0.0); pts=_ECONOMY_POINTS
    if x<=pts[0][0]:
        x0,y0=pts[0]; x1,y1=pts[1]; return y0+((x-x0)*(y1-y0))/max(0.0001,x1-x0)
    for (x0,y0),(x1,y1) in zip(pts,pts[1:]):
        if x0<=x<=x1: return y0+((x-x0)*(y1-y0))/max(0.0001,x1-x0)
    xa,ya=pts[-2]; xb,yb=pts[-1]; return yb+((x-xb)*(yb-ya))/max(0.0001,xb-xa)
def raw_overall(player: Dict[str,Any], fallback: float=0.0)->float:
    if isinstance(player,dict) and "__bmPatch32VisibleOverall" in player: return _num(player.get("__bmPatch32VisibleOverall"),fallback)
    return _num(player.get("overall",player.get("ovr",player.get("rating",fallback))),fallback)
def raw_potential(player: Dict[str,Any], fallback: float|None=None)->float:
    ovr=raw_overall(player,0.0)
    if isinstance(player,dict) and "__bmPatch32VisiblePotential" in player: return _num(player.get("__bmPatch32VisiblePotential"), fallback if fallback is not None else ovr)
    return _num(player.get("potential",player.get("pot", fallback if fallback is not None else ovr)), fallback if fallback is not None else ovr)
def player_economic_overall(player: Dict[str,Any])->float: return economy_ovr(raw_overall(player,0.0))
def player_economic_potential(player: Dict[str,Any])->float: return max(player_economic_overall(player), economy_ovr(raw_potential(player,raw_overall(player,0.0))))
def economic_player_copy(player: Dict[str,Any])->Dict[str,Any]:
    if not isinstance(player,dict): return player
    raw_ovr=raw_overall(player,0.0); raw_pot=raw_potential(player,raw_ovr); econ=economy_ovr(raw_ovr); epot=max(econ,economy_ovr(raw_pot)); out=dict(player)
    out.update({"overall":econ,"ovr":econ,"potential":epot,"pot":epot,"__bmPatch32VisibleOverall":raw_ovr,"__bmPatch32VisiblePotential":raw_pot,"__bmPatch32EconomicProxy":True,"__bmPatch33EconomicProxy":True})
    return out
def market_aav_millions(economic_overall: Any=70, age: Any=27)->float:
    ovr=_num(economic_overall,70); a=_num(age,27)
    if ovr<=66: base=1.4+max(0,ovr-60)*0.18
    elif ovr<=70: base=2.4+(ovr-66)*0.50
    elif ovr<=75: base=4.6+(ovr-70)*1.25
    elif ovr<=80: base=11.5+(ovr-75)*2.55
    elif ovr<=84: base=24.5+(ovr-80)*3.3
    elif ovr<=88: base=36.5+(ovr-84)*2.6
    elif ovr<=92: base=46.0+(ovr-88)*2.2
    else: base=54.0+(ovr-92)*1.25
    if a>=31 and ovr<88: base*=max(0.72,1-(a-30)*0.055)
    if a>=34 and ovr<92: base*=max(0.62,1-(a-33)*0.070)
    if a<=24 and ovr>=76: base*=1.04
    return max(1.2,base)
