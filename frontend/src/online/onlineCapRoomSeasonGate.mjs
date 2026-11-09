// Phase 2E.4-G1: read-only UI advisory. Supabase independently enforces all
// caps, identities, contracts, roles, and revision locks. Never authorize locally.
// Deliberately limited to 2026-27, 2027-28, 2028-29.
const isObject = v => v!==null && typeof v==='object' && !Array.isArray(v);
const numericYear = v => /^20\d{2}$/.test(String(v??'')) ? Number(v) : NaN;
const money = v => /^\d+(?:\.\d+)?$/.test(String(v??'')) ? Number(v) : NaN;

export function onlineCapRoomSeasonReady(league) {
  if (!isObject(league)) return false;
  const year = numericYear(league.seasonYear ?? league.seasonStartYear);
  if (year===2026) return true; // Keep original opening-season behavior.
  if (year!==2027 && year!==2028) return false;
  const schedule=league.onlineSchedule;
  const rollover=league.onlineSeasonRollover;
  const financials=league.financials;
  const base=financials?.baseRules;
  if (numericYear(league.seasonYear)!==year ||
      numericYear(league.seasonStartYear)!==year ||
      numericYear(schedule?.seasonYear)!==year ||
      schedule?.phase!=='regular-season' ||
      numericYear(rollover?.toYear)!==year || rollover?.status!=='complete' ||
      league.onlineOffseasonMarket!=null || league.offseasonState!=null ||
      !isObject(financials) || !isObject(base) ||
      numericYear(league.currentFinancialSeasonYear)!==year+1 ||
      numericYear(financials.currentFinancialSeasonYear)!==year+1 ||
      !(numericYear(financials.baseSeasonYear)>=2026 &&
        numericYear(financials.baseSeasonYear)<=year+1) ||
      !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(String(financials.annualInflationRate??'')))
    return false;
  const baseCap=money(base.salaryCap);
  if (!(baseCap>=10_000_000 && baseCap<=500_000_000)) return false;
  const years=year+1-numericYear(financials.baseSeasonYear);
  const cap=Math.round(baseCap*Math.pow(1+Number(financials.annualInflationRate),years)/1000)*1000;
  if (!(Number.isFinite(cap) && cap>=10_000_000 && cap<=1_000_000_000)) return false;
  if (year===2028) {
    if (!Array.isArray(league.onlineSeasonHistory) ||
        !league.onlineSeasonHistory.some(s=>isObject(s)&&numericYear(s.seasonYear)===2027))
      return false;
  }
  return true;
}
